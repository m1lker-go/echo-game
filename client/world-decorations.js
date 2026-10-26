// GLB scenery is instanced in spatial tiles: only nearby tiles are rendered.
// These props are visual decoration, never added to physics or server collisions.
const MODEL_URL='./assets/models/objects/';
const BASE_SCALE=50;
const TILE_SIZE=650;
const PALETTES={
  'plant.glb':{low:0x173448,mid:0x518fab,high:0xdceef7,opacity:0.54},
  'rocks.glb':{low:0x182c3c,mid:0x4c718b,high:0xc9dce9,opacity:0.76},
  'stones.glb':{low:0x253543,mid:0x67879b,high:0xdcebf3,opacity:0.69}
};
const ALLOWED=new Set(Object.keys(PALETTES));

function gradientMaterial(THREE,source,geometry,model) {
  const colors=PALETTES[model];
  const material=source?.clone?.()||new THREE.MeshStandardMaterial({color:0xffffff});
  // Keep material lighting, but replace unknown GLB textures with our ECHO palette.
  material.map=null;
  material.color.set(0xffffff);
  material.vertexColors=false;
  material.transparent=true;
  material.opacity=colors.opacity;
  material.depthWrite=false;
  material.depthTest=false; // Like trees: characters remain visible through scenery.
  material.side=THREE.DoubleSide;
  if(!geometry.boundingBox)geometry.computeBoundingBox();
  const bottom=geometry.boundingBox?.min.y??0;
  const height=Math.max(0.00001,(geometry.boundingBox?.max.y??1)-bottom);
  const low=new THREE.Color(colors.low),mid=new THREE.Color(colors.mid),high=new THREE.Color(colors.high);
  const vec=color=>`vec3(${color.r.toFixed(6)},${color.g.toFixed(6)},${color.b.toFixed(6)})`;
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying float vEchoDecorY;')
      .replace('#include <begin_vertex>',
        `#include <begin_vertex>
vEchoDecorY=clamp((position.y-${bottom.toFixed(6)})/${height.toFixed(6)},0.0,1.0);`);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nvarying float vEchoDecorY;')
      .replace('#include <color_fragment>',`#include <color_fragment>
float echoGrad=smoothstep(0.03,0.70,vEchoDecorY);
vec3 echoShade=mix(${vec(low)},${vec(mid)},echoGrad);
echoShade=mix(echoShade,${vec(high)},smoothstep(0.73,1.0,vEchoDecorY));
diffuseColor.rgb=mix(diffuseColor.rgb,echoShade,0.96);`);
  };
  material.customProgramCacheKey=()=>`echo-decor-${model}-${bottom}-${height}`;
  material.needsUpdate=true;
  return material;
}

export function createWorldDecorations({THREE,loader,scene,iso}) {
  const holder=new THREE.Group();
  scene.add(holder);
  let entries=[];
  const models=new Map();
  const tilesByModel=new Map();

  function clearModel(model) {
    for(const mesh of tilesByModel.get(model)||[]){
      holder.remove(mesh);
      mesh.dispose?.(); // Frees per-instance buffers; shared GLB geometries remain loaded.
    }
    tilesByModel.delete(model);
  }

  function createInstances(model){
    clearModel(model);
    const parts=models.get(model);
    if(!parts)return;
    const matches=entries.filter(item=>item.model===model);
    if(!matches.length)return;
    const groups=new Map();
    for(const entry of matches){
      const tile=Math.floor(entry.x/TILE_SIZE)+':'+Math.floor(entry.y/TILE_SIZE);
      if(!groups.has(tile))groups.set(tile,[]);
      groups.get(tile).push(entry);
    }
    const batches=[];
    const object=new THREE.Object3D();
    const transform=new THREE.Matrix4();
    for(const part of parts){
      for(const values of groups.values()){
        const mesh=new THREE.InstancedMesh(part.geometry,part.material,values.length);
        mesh.frustumCulled=true;
        mesh.castShadow=false;
        mesh.receiveShadow=false;
        mesh.renderOrder=0;
        for(let i=0;i<values.length;i++){
          const value=values[i];
          object.position.set((value.x-value.y)*iso.x,-(value.x+value.y)*iso.y,0);
          object.rotation.set(0,value.rotation,0);
          object.scale.setScalar(BASE_SCALE*value.scale);
          object.updateMatrix();
          transform.multiplyMatrices(object.matrix,part.matrix);
          mesh.setMatrixAt(i,transform);
        }
        mesh.instanceMatrix.needsUpdate=true;
        mesh.computeBoundingSphere();
        holder.add(mesh);
        batches.push(mesh);
      }
    }
    tilesByModel.set(model,batches);
  }

  function loadModel(model){
    if(models.has(model))return;
    models.set(model,null); // Prevent repeated requests on reconnect.
    loader.load(MODEL_URL+model,gltf=>{
      gltf.scene.updateMatrixWorld(true);
      const parts=[];
      gltf.scene.traverse(child=>{
        if(!child.isMesh||child.isSkinnedMesh)return;
        parts.push({
          geometry:child.geometry,
          material:gradientMaterial(THREE,child.material,child.geometry,model),
          matrix:child.matrixWorld.clone()
        });
      });
      models.set(model,parts);
      createInstances(model);
      console.info('[echo] decorations loaded: '+model+' ('+entries.filter(x=>x.model===model).length+' instances)');
    },undefined,error=>{
      models.delete(model);
      console.warn('[echo] decoration GLB failed: '+model,error);
    });
  }

  function setSnapshot(snapshot) {
    if(!Array.isArray(snapshot))return;
    entries=snapshot.filter(item=>item&&ALLOWED.has(item.model)&&
      typeof item.id==='string'&&Number.isFinite(item.x)&&Number.isFinite(item.y)&&
      Number.isFinite(item.scale)&&item.scale>0&&item.scale<=1.3&&
      Number.isFinite(item.rotation));
    for(const model of ALLOWED) {
      if(models.has(model)){
        if(models.get(model))createInstances(model);
      }else if(entries.some(item=>item.model===model))loadModel(model);
    }
  }
  function update(cameraX,cameraY) {
    holder.position.set(-(cameraX-cameraY)*iso.x,(cameraX+cameraY)*iso.y,0);
  }
  return {setSnapshot,update};
}
