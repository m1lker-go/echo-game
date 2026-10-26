// GLB scenery is instanced in spatial tiles: only nearby tiles are rendered.
// These props are visual decoration, never added to physics or server collisions.
const MODEL_URL='./assets/models/objects/';
const BASE_SCALE=50;
const TILE_SIZE=650;
// ECHO uses a straight-on +Z camera and projects the ground to isometric XY.
// Rotate the local GLB XZ floor before placing each copy in that 2.5D scene.
// sin(tilt)=1/sqrt(3) makes its projected footprint follow the same 2:1
// screen-axis slopes as worldToScreenPrecise in game.js.
const ISOMETRIC_TILT=Math.asin(1/Math.sqrt(3));
const ISOMETRIC_YAW=-Math.PI/4;
// Every prop is decorative. Keep it behind characters in camera depth while
// leaving tree placement, player movement and physics entirely unchanged.
const BACKGROUND_DEPTH=-75;
const BACKGROUND_ORDER=-5;
const PALETTES={
  'plant.glb':{low:0x173448,mid:0x518fab,high:0xdceef7,opacity:0.5},
  'rocks.glb':{low:0x182c3c,mid:0x4c718b,high:0xc9dce9,opacity:0.5},
  'flowers-tall.glb':{low:0x173448,mid:0x568da8,high:0xe2f6ff,opacity:0.5},
  'tree-trunk.glb':{low:0x182c3c,mid:0x4c718b,high:0xc9dce9,opacity:0.5}
};
const ALLOWED=new Set(Object.keys(PALETTES));
// Client scale validation mirrors the active server models.
const SCALE_RANGES={
  'plant.glb':{min:0.7,max:1.2},
  'rocks.glb':{min:0.3,max:0.6},
  'flowers-tall.glb':{min:0.6,max:0.8},
  'tree-trunk.glb':{min:3,max:4}
};

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
  // Unlike the old decorative layer, respect the hero's depth buffer so
  // transparent rocks/plants never paint over a player in front of them.
  material.depthTest=true;
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
    if(model==='flowers-tall.glb') {
      // No extra light sources: add a soft, localized glow to the upper
      // blossoms in the existing material shader. Stems remain unlit.
      shader.fragmentShader=shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `float echoPetalGlow=smoothstep(0.62,0.92,vEchoDecorY);
outgoingLight += vec3(0.11,0.26,0.37)*echoPetalGlow;
#include <opaque_fragment>`
      );
    }
  };
  material.customProgramCacheKey=()=>`echo-decor-${model}-${bottom}-${height}`;
  material.needsUpdate=true;
  return material;
}

export function createWorldDecorations({THREE,loader,scene,iso}) {
  const holder=new THREE.Group();
  scene.add(holder);
  let entries=[];
  let deathFlowers=[]; // Per-room PvP memorials, sent by the authoritative server.
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
    const matches=model==='flowers-tall.glb'
      ? deathFlowers
      : entries.filter(item=>item.model===model);
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
        mesh.renderOrder=BACKGROUND_ORDER;
        for(let i=0;i<values.length;i++){
          const value=values[i];
          object.position.set((value.x-value.y)*iso.x,-(value.x+value.y)*iso.y,BACKGROUND_DEPTH);
          // Tilt the imported horizontal XZ plane toward the isometric camera.
          // Euler XYZ evaluates as Rx(tilt)*Ry(yaw); randomized yaw stays flat
          // on the ground rather than rolling rocks around their sides.
          object.rotation.set(ISOMETRIC_TILT,ISOMETRIC_YAW+value.rotation,0,'XYZ');
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
      console.info('[echo] decorations loaded: '+model+' ('+(model==='flowers-tall.glb'?deathFlowers:entries.filter(x=>x.model===model)).length+' instances)');
    },undefined,error=>{
      models.delete(model);
      console.warn('[echo] decoration GLB failed: '+model,error);
    });
  }

  function setSnapshot(snapshot) {
    if(!Array.isArray(snapshot))return;
    entries=snapshot.filter(item=>item&&item.model!=='flowers-tall.glb'&&ALLOWED.has(item.model)&&
      typeof item.id==='string'&&Number.isFinite(item.x)&&Number.isFinite(item.y)&&
      Number.isFinite(item.scale)&&item.scale>=SCALE_RANGES[item.model].min&&
      item.scale<=SCALE_RANGES[item.model].max&&
      Number.isFinite(item.rotation));
    for(const model of ALLOWED) {
      if(models.has(model)){
        if(models.get(model))createInstances(model);
      }else if(entries.some(item=>item.model===model))loadModel(model);
    }
  }
  function setDeathFlowers(snapshot){
    if(!Array.isArray(snapshot))return;
    deathFlowers=snapshot.slice(0,250).filter(item=>item&&
      item.model==='flowers-tall.glb'&&typeof item.id==='string'&&
      Number.isFinite(item.x)&&Number.isFinite(item.y)&&
      Number.isFinite(item.rotation)&&Number.isFinite(item.scale)&&
      item.scale>=SCALE_RANGES['flowers-tall.glb'].min&&
      item.scale<=SCALE_RANGES['flowers-tall.glb'].max);
    if(models.has('flowers-tall.glb')){
      if(models.get('flowers-tall.glb'))createInstances('flowers-tall.glb');
    }else if(deathFlowers.length)loadModel('flowers-tall.glb');
  }
  function update(cameraX,cameraY) {
    holder.position.set(-(cameraX-cameraY)*iso.x,(cameraX+cameraY)*iso.y,0);
  }
  return {setSnapshot,setDeathFlowers,update};
}
