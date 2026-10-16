// Low-cost mobile floor reflection for ECHO's screen-space isometric renderer.
// Only the current client's character is reflected. Trees, other players and
// water remain untouched. No second WebGL context, framebuffer or full-screen blur.
export function createMobileFloorReflections({ THREE, renderer, scene, camera }) {
  const disabledByUrl = new URLSearchParams(location.search).has('noReflections');
  const REFLECTION_LAYER = 1;
  const MIRROR_HEIGHT = 0.72;
  const MIRROR_GAP = 3;
  const BASE_OPACITY = 0.15; // feet: 15%; reflected top: 0%

  // After mirroring Y, +135 degrees sends the silhouette towards screen
  // upper-right (+X,+Y), regardless of the character's facing animation.
  const MIRROR_TILT = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), Math.PI * 0.75
  );
  const reflectedMaterials = new WeakMap();
  const modelHeights = new WeakMap();
  const savedRotation = new THREE.Quaternion();
  let disabledAfterError = false;

  function heightOf(root) {
    const cached = modelHeights.get(root);
    if (cached !== undefined) return cached;
    // Compute once per character instance, not every animation frame.
    const box = new THREE.Box3().setFromObject(root);
    const top = box.max.y - root.position.y;
    const height = Math.max(20, Number.isFinite(top) && top > 0 ? top : 75);
    modelHeights.set(root, height);
    return height;
  }

  function reflectionMaterial(original) {
    let material = reflectedMaterials.get(original);
    if (material) return material;

    const base = { value: new THREE.Vector2() };
    const span = { value: 60 };
    material = new THREE.MeshBasicMaterial({
      map: original?.map || null,
      alphaMap: original?.alphaMap || null,
      color: 0x92b5cc,
      transparent: true,
      opacity: BASE_OPACITY,
      depthTest: false,
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
          '#include <common>\nvarying float vEchoFade;\nuniform vec2 uEchoBase;\nuniform float uEchoSpan;')
        .replace('#include <skinning_vertex>',
          '#include <skinning_vertex>\n' +
          'vec2 echoXY = (modelMatrix * vec4(transformed, 1.0)).xy;\n' +
          'vEchoFade = clamp(dot(echoXY - uEchoBase, vec2(0.70710678, 0.70710678)) / max(uEchoSpan, 1.0), 0.0, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vEchoFade;')
        .replace('#include <opaque_fragment>',
          '#include <opaque_fragment>\n' +
          'gl_FragColor.a *= pow(1.0 - smoothstep(0.0, 1.0, vEchoFade), 1.2);');
    };
    reflectedMaterials.set(original, material);
    return material;
  }

  // Extra arguments are deliberately ignored to preserve the existing
  // game.js call without changing any movement, water or tree handling.
  function render(local) {
    if (disabledByUrl || disabledAfterError || document.hidden || !local?.visible) {
      renderer.render(scene, camera);
      return;
    }

    const oldLayers = camera.layers.mask;
    const oldAutoClear = renderer.autoClear;
    const oldY = local.position.y;
    const oldScaleY = local.scale.y;
    savedRotation.copy(local.quaternion);
    const changedMeshes = [];
    let passSucceeded = false;

    try {
      const span = heightOf(local) * MIRROR_HEIGHT;
      local.position.y -= MIRROR_GAP;
      local.scale.y *= -MIRROR_HEIGHT;
      local.quaternion.premultiply(MIRROR_TILT);

      local.traverse(mesh => {
        if (!mesh.isMesh) return;
        const materials = mesh.material;
        changedMeshes.push({
          mesh,
          material: materials,
          layers: mesh.layers.mask,
          frustumCulled: mesh.frustumCulled,
        });
        const prepare = original => {
          const reflected = reflectionMaterial(original);
          reflected.userData.echoBase.value.set(local.position.x, local.position.y);
          reflected.userData.echoSpan.value = span;
          return reflected;
        };
        mesh.material = Array.isArray(materials)
          ? materials.map(prepare)
          : prepare(materials);
        mesh.layers.enable(REFLECTION_LAYER);
        mesh.frustumCulled = false;
      });

      // Only local-character meshes have the reflection layer enabled.
      camera.layers.set(REFLECTION_LAYER);
      renderer.autoClear = true;
      renderer.render(scene, camera);
      passSucceeded = true;
    } catch (error) {
      disabledAfterError = true;
      console.warn('[echo] Lightweight reflection disabled after error', error);
    } finally {
      // Every temporary change is undone before regular game rendering.
      local.position.y = oldY;
      local.scale.y = oldScaleY;
      local.quaternion.copy(savedRotation);
      for (const { mesh, material, layers, frustumCulled } of changedMeshes) {
        mesh.material = material;
        mesh.layers.mask = layers;
        mesh.frustumCulled = frustumCulled;
      }
      camera.layers.mask = oldLayers;
      renderer.autoClear = passSucceeded ? false : oldAutoClear;
    }

    try {
      // The character and world render normally over the faint reflection.
      renderer.render(scene, camera);
    } finally {
      renderer.autoClear = oldAutoClear;
    }
  }

  return { render };
}
