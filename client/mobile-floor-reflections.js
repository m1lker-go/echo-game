// Mobile-first floor reflections for ECHO's 2D-isometric / Three.js screen-space renderer.
// One additional pass reuses the ORIGINAL animated objects: no cloned GLBs, skeletons,
// canvases or framebuffers. Only this client's character and nearby trees participate.
export function createMobileFloorReflections({ THREE, renderer, scene, camera }) {
  const disabledByUrl = new URLSearchParams(location.search).has('noReflections');
  const REFLECTION_LAYER = 1;
  const MAX_TREES = 4;
  const MAX_TREE_DISTANCE = 510;
  const MIRROR_HEIGHT = 0.72;
  const MIRROR_GAP = 3;
  // Tilt the mirrored silhouette to screen-right by 45 degrees, regardless of facing.
  const MIRROR_TILT = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), Math.PI / 4
  );
  const reflectionMaterials = new WeakMap();
  let disabledAfterError = false;

  function reflectionMaterial(source, isTree) {
    let pair = reflectionMaterials.get(source);
    if (!pair) {
      pair = {};
      reflectionMaterials.set(source, pair);
    }
    const kind = isTree ? 'tree' : 'player';
    if (pair[kind]) return pair[kind];

    // Keep the original skin's diffuse texture, but never change its material.
    const material = new THREE.MeshBasicMaterial({
      map: source?.map || null,
      alphaMap: source?.alphaMap || null,
      color: 0x92b5cc,
      transparent: true,
      // ~30% softer than the original reflections (tree 0.18, player 0.32).
      opacity: isTree ? 0.12 : 0.22,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });

    // Fade the mirrored silhouette away from the model's ground contact.
    // The source models use Y-up coordinates; animation skinning happens before
    // this height is read. This is only a visual effect, not a 3D floor plane.
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vEchoMirrorHeight;')
        .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvEchoMirrorHeight = max(0.0, transformed.y);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vEchoMirrorHeight;')
        .replace('#include <opaque_fragment>',
          '#include <opaque_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(0.0, 2.8, vEchoMirrorHeight);');
    };
    pair[kind] = material;
    return material;
  }

  function render(local, trees, width, height) {
    if (disabledByUrl || disabledAfterError || document.hidden) {
      renderer.render(scene, camera);
      return;
    }

    const selected = [];
    if (local?.visible) selected.push({ root: local, isTree: false });

    const playerX = local?.position.x || 0;
    const playerY = local?.position.y || 0;
    const nearby = [];
    for (const tree of trees) {
      const root = tree.root;
      if (!root?.visible) continue;
      if (Math.abs(root.position.x) > width / 2 + 130 ||
          Math.abs(root.position.y) > height / 2 + 160) continue;
      const dx = root.position.x - playerX;
      const dy = root.position.y - playerY;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > MAX_TREE_DISTANCE * MAX_TREE_DISTANCE) continue;
      nearby.push({ root, distanceSquared });
    }
    nearby.sort((a, b) => a.distanceSquared - b.distanceSquared);
    for (const tree of nearby.slice(0, MAX_TREES)) {
      selected.push({ root: tree.root, isTree: true });
    }
    if (!selected.length) {
      renderer.render(scene, camera);
      return;
    }

    const oldCameraLayers = camera.layers.mask;
    const oldAutoClear = renderer.autoClear;
    const changedRoots = [];
    const changedMeshes = [];
    let reflected = false;
    try {
      for (const { root, isTree } of selected) {
        changedRoots.push({
          root,
          y: root.position.y,
          sy: root.scale.y,
          quaternion: root.quaternion.clone(),
        });
        root.position.y -= MIRROR_GAP;
        root.scale.y *= -MIRROR_HEIGHT;
        // Pre-multiplication keeps the tilt in screen coordinates, so running
        // toward/away/sideways cannot rotate the reflection's floor direction.
        root.quaternion.premultiply(MIRROR_TILT);
        root.traverse(mesh => {
          if (!mesh.isMesh) return;
          changedMeshes.push({
            mesh,
            material: mesh.material,
            layers: mesh.layers.mask,
            frustumCulled: mesh.frustumCulled,
          });
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map(source => reflectionMaterial(source, isTree))
            : reflectionMaterial(mesh.material, isTree);
          mesh.layers.enable(REFLECTION_LAYER);
          mesh.frustumCulled = false;
        });
      }
      // All other players and all water keep their original layer (0).
      // The temporary camera layer renders ONLY the selected mirrored meshes.
      camera.layers.set(REFLECTION_LAYER);
      renderer.autoClear = true;
      renderer.render(scene, camera);
      reflected = true;
    } catch (error) {
      disabledAfterError = true;
      console.warn('[echo] Floor reflections disabled after rendering error', error);
    } finally {
      // Restore gameplay-visible objects even if a device fails to render the effect.
      for (const { root, y, sy, quaternion } of changedRoots) {
        root.position.y = y;
        root.scale.y = sy;
        root.quaternion.copy(quaternion);
      }
      for (const { mesh, material, layers, frustumCulled } of changedMeshes) {
        mesh.material = material;
        mesh.layers.mask = layers;
        mesh.frustumCulled = frustumCulled;
      }
      camera.layers.mask = oldCameraLayers;
      renderer.autoClear = reflected ? false : oldAutoClear;
    }
    try {
      renderer.render(scene, camera);
    } finally {
      renderer.autoClear = oldAutoClear;
    }
  }

  return { render };
}
