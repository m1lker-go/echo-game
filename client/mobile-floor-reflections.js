// Lightweight mobile floor reflections. Kept inside the existing WebGL context.
// Only the local character and nearby trees are mirrored. Remote players and water are excluded.
export function createMobileFloorReflections({THREE,renderer,camera,scene,cloneSkeleton}) {
  const enabled = !new URLSearchParams(location.search).has('noReflections');
  const reflectionScene = new THREE.Scene();
  const reflectedRoots = new WeakMap();
  const materialCache = new WeakMap();
  const mirrorCamera = camera;
  const maxTrees = 6;
  const maxTreeDistance = 580;
  let target = null;
  let targetWidth = 0, targetHeight = 0;
  let active = [];
  const mirroredGround = new THREE.Group();
  reflectionScene.add(mirroredGround);
    const discardColor = new THREE.Color('#7399AB');

  function material(source, isTree) {
    let entry = materialCache.get(source);
    if (!entry) {
      // Mirror passes must not mutate original materials or animations.
      const m = new THREE.MeshBasicMaterial({
        map: source.map || null,
        color: discardColor,
        transparent: true,
        opacity: isTree ? 0.15 : 0.34,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      });
      entry = { character: m, tree: m.clone() };
      entry.tree.opacity = 0.15;
      entry.character.opacity = 0.34;
      materialCache.set(source, entry);
    }
    return isTree ? entry.tree : entry.character;
  }

  function makeReflection(original, isTree) {
    // Trees are static. Character skin/bones are updated from the ORIGINAL skeleton
    // before rendering, rather than running another AnimationMixer.
    const mirror = cloneSkeleton(original);
    mirror.traverse(node => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      node.material = Array.isArray(node.material)
        ? materials.map(m => material(m, isTree))
        : material(materials[0], isTree);
      node.frustumCulled = false;
      node.castShadow = false;
      node.receiveShadow = false;
    });
    mirror.userData.original = original;
    mirror.userData.isTree = isTree;
    mirroredGround.add(mirror);
    return mirror;
  }

  function getMirror(original, isTree) {
    let mirror = reflectedRoots.get(original);
    if (!mirror) {
      mirror = makeReflection(original, isTree);
      reflectedRoots.set(original, mirror);
    }
    return mirror;
  }

  function syncMirror(original, mirror) {
    original.updateWorldMatrix(true, true);
    mirror.position.copy(original.position);
    mirror.quaternion.copy(original.quaternion);
    mirror.scale.copy(original.scale);
    // In this game's screen-space orthographic renderer, model Y is vertical.
    // Negative Y creates a floor-facing reflection from the model foot origin.
    mirror.scale.y *= -1;
    mirror.position.y -= 3;
    mirror.visible = original.visible;
    const originalBones = [], mirrorBones = [];
    original.traverse(node => { if(node.isBone) originalBones.push(node); });
    mirror.traverse(node => { if(node.isBone) mirrorBones.push(node); });
    if(originalBones.length === mirrorBones.length) {
      for(let i=0;i<originalBones.length;i++) {
        mirrorBones[i].position.copy(originalBones[i].position);
        mirrorBones[i].quaternion.copy(originalBones[i].quaternion);
        mirrorBones[i].scale.copy(originalBones[i].scale);
      }
    }
  }

  function ensureTarget(width,height) {
    const scale = 0.5; // half resolution to limit fragment cost on phones
    const w = Math.max(1,Math.floor(width*scale)),h = Math.max(1,Math.floor(height*scale));
    if(target && targetWidth === w && targetHeight === h) return;
    target?.dispose();
    target = new THREE.WebGLRenderTarget(w,h,{depthBuffer:false,stencilBuffer:false});
    target.texture.colorSpace=THREE.SRGBColorSpace;
    targetWidth=w;targetHeight=h;
  }

  const outputScene = new THREE.Scene();
  const outputCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const output = new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({
    transparent: true,depthTest:false,depthWrite:false,
    uniforms:{ tReflection:{value:null}, strength:{value:1} },
    vertexShader:'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:`uniform sampler2D tReflection; varying vec2 vUv;
      void main(){
        vec4 c=texture2D(tReflection,vUv);
        // Maintain a subtle gloss; silhouettes are already transparent in the target.
        gl_FragColor=vec4(c.rgb,c.a);
      }`,
  }));
  outputScene.add(output);

  function render(local,trees,width,height) {
    if(!enabled || document.hidden || width < 1 || height < 1) return;
    ensureTarget(width,height);
    active.length=0;
    if(local && local.visible) {
      const mirror=getMirror(local,false);
      syncMirror(local,mirror);
      active.push(mirror);
    }
    const closest=trees.filter(t=>t.root && t.root.visible && local &&
      Math.hypot(t.root.position.x-local.position.x,t.root.position.y-local.position.y)<maxTreeDistance)
      .sort((a,b)=> {
        const da=Math.hypot(a.root.position.x-local.position.x,a.root.position.y-local.position.y);
        const db=Math.hypot(b.root.position.x-local.position.x,b.root.position.y-local.position.y);
        return da-db;
      }).slice(0,maxTrees);
    for(const tree of closest) {
      const mirror=getMirror(tree.root,true);
      syncMirror(tree.root,mirror);
      active.push(mirror);
    }
    for(const mirror of mirroredGround.children)mirror.visible=active.includes(mirror);
    const prev=renderer.getRenderTarget();
    const autoClear=renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.autoClear=true;
    renderer.setClearColor(0x000000,0);
    renderer.clear(true,true,true);
    renderer.render(reflectionScene,mirrorCamera);
    renderer.setRenderTarget(prev);
    renderer.autoClear=false;
    output.material.uniforms.tReflection.value=target.texture;
    renderer.render(outputScene,outputCamera);
    renderer.autoClear=autoClear;
  }
  return {render};
}
