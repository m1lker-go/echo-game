// ECHO: animated reflection of the LOCAL hero only.
// A separate SkeletonUtils clone, never a temporary transform/material on the hero.
// One scene render; no framebuffers, fullscreen blur, trees or remote players.
export function createMobileFloorReflections({ THREE, renderer, scene, camera, cloneSkeleton }) {
  const disabledByUrl = new URLSearchParams(location.search).has('noReflections');
  const MIRROR_HEIGHT = 0.72;
  const MIRROR_GAP = 3;
  const REFLECTION_DEPTH = -85; // behind the real hero in the orthographic camera
  const BASE_OPACITY = 0.08;   // at feet: 8%, at the tip: 0%
  const MIRROR_TILT = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), Math.PI * 0.25
  );
  const reflectedMaterials = new WeakMap();
  const heights = new WeakMap();
  let mirror = null;
  let disabledAfterError = false;

  function heightOf(local) {
    const cached = heights.get(local);
    if (cached !== undefined) return cached;
    const box = new THREE.Box3().setFromObject(local);
    const top = box.max.y - local.position.y;
    const height = Math.max(20, Number.isFinite(top) && top > 0 ? top : 75);
    heights.set(local, height);
    return height;
  }

  function reflectionMaterial(original) {
    const cached = original && reflectedMaterials.get(original);
    if (cached) return cached;
    const base = { value: new THREE.Vector2() };
    const span = { value: 60 };
    const material = new THREE.MeshBasicMaterial({
      map: original?.map || null,
      alphaMap: original?.alphaMap || null,
      alphaTest: original?.alphaTest || 0,
      color: 0x92b5cc,
      transparent: true,
      opacity: BASE_OPACITY,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    material.userData.echoBase = base;
    material.userData.echoSpan = span;
    material.onBeforeCompile = shader => {
      shader.uniforms.uEchoBase = base;
      shader.uniforms.uEchoSpan = span;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying float vEchoDistance;\nuniform vec2 uEchoBase;')
        .replace('#include <skinning_vertex>',
          '#include <skinning_vertex>\n' +
          'vec2 echoXY = (modelMatrix * vec4(transformed, 1.0)).xy;\n' +
          'vEchoDistance = dot(echoXY - uEchoBase, vec2(0.70710678, -0.70710678));');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nvarying float vEchoDistance;\nuniform float uEchoSpan;')
        .replace('#include <opaque_fragment>',
          '#include <opaque_fragment>\n' +
          'if (vEchoDistance < 0.0) discard;\n' +
          'float echoFade = clamp(vEchoDistance / max(uEchoSpan, 1.0), 0.0, 1.0);\n' +
          'gl_FragColor.a *= pow(1.0 - smoothstep(0.0, 1.0, echoFade), 1.2);');
    };
    if (original) reflectedMaterials.set(original, material);
    return material;
  }

  function discardMirror() {
    if (!mirror) return;
    scene.remove(mirror.root);
    for (const material of mirror.materials) material.dispose();
    mirror = null;
  }

  function createMirror(local) {
    // local.userData holds the AnimationMixer, so cloning local is unsafe.
    // Only clone the visual GLTF child; SkeletonUtils remaps its bones.
    const visual = local.children[0];
    if (!visual || typeof cloneSkeleton !== 'function') return null;
    const clone = cloneSkeleton(visual);
    const originals = [], copies = [];
    visual.traverse(node => originals.push(node));
    clone.traverse(node => copies.push(node));
    if (originals.length !== copies.length) {
      throw new Error('Reflection skeleton hierarchy differs from original');
    }

    const root = new THREE.Group();
    root.name = 'echo-local-character-reflection';
    root.visible = false;
    root.add(clone);

    const materials = new Set();
    for (let i = 0; i < copies.length; i++) {
      const node = copies[i];
      if (!node.isMesh) continue;
      const sourceMaterial = originals[i].material;
      node.material = Array.isArray(sourceMaterial)
        ? sourceMaterial.map(reflectionMaterial)
        : reflectionMaterial(sourceMaterial);
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) materials.add(material);
      node.layers.set(0);
      node.renderOrder = -50;
      node.frustumCulled = false;
      node.castShadow = false;
      node.receiveShadow = false;
    }

    scene.add(root);
    return { local, root, originals, copies, materials };
  }

  function syncMirror(local) {
    if (mirror?.local !== local) {
      discardMirror();
      mirror = createMirror(local);
    }
    if (!mirror) return;

    // The original AnimationMixer has already updated the real skeleton.
    // Synchronize cloned bones and morphs without touching the source.
    for (let i = 0; i < mirror.originals.length; i++) {
      const source = mirror.originals[i], copy = mirror.copies[i];
      copy.position.copy(source.position);
      copy.quaternion.copy(source.quaternion);
      copy.scale.copy(source.scale);
      copy.visible = source.visible;
      if (source.morphTargetInfluences && copy.morphTargetInfluences) {
        for (let j = 0; j < source.morphTargetInfluences.length; j++) {
          copy.morphTargetInfluences[j] = source.morphTargetInfluences[j];
        }
      }
    }

    mirror.root.position.copy(local.position);
    mirror.root.position.y -= MIRROR_GAP;
    mirror.root.position.z = REFLECTION_DEPTH;
    mirror.root.quaternion.copy(local.quaternion).premultiply(MIRROR_TILT);
    mirror.root.scale.copy(local.scale);
    mirror.root.scale.y *= -MIRROR_HEIGHT;

    const span = heightOf(local) * MIRROR_HEIGHT;
    for (const material of mirror.materials) {
      material.userData.echoBase.value.set(mirror.root.position.x, mirror.root.position.y);
      material.userData.echoSpan.value = span;
    }
    mirror.root.visible = true;
  }

  // Legacy extra game.js arguments are ignored; world and trees remain untouched.
  function render(local) {
    if (disabledByUrl || disabledAfterError || document.hidden || !local?.visible) {
      if (mirror) mirror.root.visible = false;
    } else {
      try {
        syncMirror(local);
      } catch (error) {
        disabledAfterError = true;
        discardMirror();
        console.warn('[echo] Animated reflection disabled after error', error);
      }
    }
    renderer.render(scene, camera);
  }

  return { render };
}
