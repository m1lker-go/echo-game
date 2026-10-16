// Mobile-first, screen-space floor reflections for ECHO.
// Renders only the local animated character and nearby trees, never other players or water.
// Reuses the ORIGINAL meshes/skeletons and the existing WebGL context.
export function createMobileFloorReflections({ THREE, renderer, scene, camera }) {
  const disabledByUrl = new URLSearchParams(location.search).has('noReflections');
  const REFLECTION_LAYER = 1;
  const MAX_TREES = 4;
  const MAX_TREE_DISTANCE = 510;
  const MIRROR_HEIGHT = 0.72;
  const MIRROR_GAP = 3;
  const REFLECTION_OPACITY = 0.15; // at the feet/trunk; 0 at the top
  const RESOLUTION = 0.5; // half CSS resolution, with linear upscaling for mobile
  const MIRROR_TILT = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), Math.PI / 4
  );
  const reflectionMaterials = new WeakMap();
  const originalHeights = new WeakMap();
  const savedClearColor = new THREE.Color();
  let disabledAfterError = false;
  let target = null;
  let targetWidth = 0;
  let targetHeight = 0;

  // A small full-screen blur is cheaper than rendering the models several times.
  const compositeScene = new THREE.Scene();
  const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tReflection: { value: null },
      texelSize: { value: new THREE.Vector2(1, 1) },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: [
      'uniform sampler2D tReflection;',
      'uniform vec2 texelSize;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec2 radius = texelSize * 2.0;',
      '  vec4 sum = texture2D(tReflection, vUv) * 0.28;',
      '  sum += texture2D(tReflection, vUv + vec2(radius.x, 0.0)) * 0.18;',
      '  sum += texture2D(tReflection, vUv - vec2(radius.x, 0.0)) * 0.18;',
      '  sum += texture2D(tReflection, vUv + vec2(0.0, radius.y)) * 0.18;',
      '  sum += texture2D(tReflection, vUv - vec2(0.0, radius.y)) * 0.18;',
      // The transparent render target stores premultiplied RGB. Convert back
      // before normal alpha blending onto the transparent models canvas.
      '  gl_FragColor = vec4(sum.rgb / max(sum.a, 0.0001), sum.a);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  compositeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial));

  function ensureTarget(width, height) {
    const w = Math.max(1, Math.ceil(width * RESOLUTION));
    const h = Math.max(1, Math.ceil(height * RESOLUTION));
    if (target && w === targetWidth && h === targetHeight) return;
    if (target) target.dispose();
    target = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    targetWidth = w;
    targetHeight = h;
    compositeMaterial.uniforms.tReflection.value = target.texture;
    compositeMaterial.uniforms.texelSize.value.set(1 / w, 1 / h);
  }

  function getOriginalHeight(root) {
    const cached = originalHeights.get(root);
    if (cached) return cached;
    // Measure the complete model, not the height of one mesh/branch.
    // This is computed once per model, before its temporary mirror transform.
    const bounds = new THREE.Box3().setFromObject(root);
    const top = bounds.max.y - root.position.y;
    const height = Math.max(12, Number.isFinite(top) && top > 0
      ? top : bounds.max.y - bounds.min.y || 65);
    originalHeights.set(root, height);
    return height;
  }

  function reflectionMaterial(root, source) {
    let materials = reflectionMaterials.get(root);
    if (!materials) {
      materials = new WeakMap();
      reflectionMaterials.set(root, materials);
    }
    let material = materials.get(source);
    if (material) return material;

    const originUniform = { value: new THREE.Vector2() };
    const heightUniform = { value: 65 };
    material = new THREE.MeshBasicMaterial({
      map: source?.map || null,
      alphaMap: source?.alphaMap || null,
      color: 0x92b5cc,
      transparent: true,
      opacity: REFLECTION_OPACITY,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    material.userData.echoOrigin = originUniform;
    material.userData.echoHeight = heightUniform;
    material.onBeforeCompile = shader => {
      shader.uniforms.uEchoOrigin = originUniform;
      shader.uniforms.uEchoHeight = heightUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying float vEchoHeight;\nuniform vec2 uEchoOrigin;\nuniform float uEchoHeight;')
        .replace('#include <skinning_vertex>',
          '#include <skinning_vertex>\n' +
          'vec2 echoWorld = (modelMatrix * vec4(transformed, 1.0)).xy;\n' +
          // Axis follows the screen-space 45-degree tilted reflection.
          'vEchoHeight = clamp(dot(echoWorld - uEchoOrigin, vec2(0.70710678, -0.70710678)) / max(uEchoHeight, 1.0), 0.0, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vEchoHeight;')
        .replace('#include <opaque_fragment>',
          '#include <opaque_fragment>\n' +
          // 15% at the base, continuously fading to fully transparent at the tip.
          'gl_FragColor.a *= pow(1.0 - smoothstep(0.0, 1.0, vEchoHeight), 1.2);');
    };
    materials.set(source, material);
    return material;
  }

  function render(local, trees, width, height) {
    if (disabledByUrl || disabledAfterError || document.hidden) {
      renderer.render(scene, camera);
      return;
    }
    const selected = [];
    if (local?.visible) selected.push(local);
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
    for (const tree of nearby.slice(0, MAX_TREES)) selected.push(tree.root);
    if (!selected.length) {
      renderer.render(scene, camera);
      return;
    }

    const oldCameraLayers = camera.layers.mask;
    const oldAutoClear = renderer.autoClear;
    const oldRenderTarget = renderer.getRenderTarget();
    renderer.getClearColor(savedClearColor);
    const oldClearAlpha = renderer.getClearAlpha();
    const changedRoots = [];
    const changedMeshes = [];
    let renderedReflection = false;

    try {
      ensureTarget(width, height);
      for (const root of selected) {
        const mirrorSpan = getOriginalHeight(root) * MIRROR_HEIGHT;
        changedRoots.push({
          root,
          y: root.position.y,
          sy: root.scale.y,
          quaternion: root.quaternion.clone(),
        });
        root.position.y -= MIRROR_GAP;
        root.scale.y *= -MIRROR_HEIGHT;
        root.quaternion.premultiply(MIRROR_TILT);

        root.traverse(mesh => {
          if (!mesh.isMesh) return;
          changedMeshes.push({
            mesh,
            material: mesh.material,
            layers: mesh.layers.mask,
            frustumCulled: mesh.frustumCulled,
          });
          const prepare = source => {
            const result = reflectionMaterial(root, source);
            result.userData.echoOrigin.value.set(root.position.x, root.position.y);
            result.userData.echoHeight.value = mirrorSpan;
            return result;
          };
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map(prepare)
            : prepare(mesh.material);
          mesh.layers.enable(REFLECTION_LAYER);
          mesh.frustumCulled = false;
        });
      }

      // Render only mirrored local meshes and tree meshes at reduced resolution.
      // Remote players, water, and scene backgrounds stay on layer 0.
      camera.layers.set(REFLECTION_LAYER);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.render(scene, camera);
      renderedReflection = true;
    } catch (error) {
      disabledAfterError = true;
      console.warn('[echo] Floor reflections disabled after rendering error', error);
    } finally {
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
      renderer.setRenderTarget(oldRenderTarget);
      renderer.setClearColor(savedClearColor, oldClearAlpha);
      renderer.autoClear = oldAutoClear;
    }

    if (renderedReflection) {
      try {
        // Blurred reflections go UNDER the unchanged normal scene.
        renderer.clear(true, true, true);
        renderer.autoClear = false;
        renderer.render(compositeScene, compositeCamera);
        renderer.render(scene, camera);
      } catch (error) {
        disabledAfterError = true;
        console.warn('[echo] Reflection composite failed; falling back to regular rendering', error);
        renderer.autoClear = true;
        renderer.render(scene, camera);
      } finally {
        renderer.autoClear = oldAutoClear;
      }
    } else {
      renderer.render(scene, camera);
    }
  }

  return { render };
}
