import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Kenney Mini Characters reference Textures/colormap.png beside the GLB.
// Our project keeps the shared atlas in client/assets/textures/.
THREE.DefaultLoadingManager.setURLModifier((url) => {
  const selectedModel = window.localStorage?.getItem('echo.selectedModel');
  const defaultModel = '/assets/models/character-female-a.glb';
  if (selectedModel && url.endsWith(defaultModel)) {
    return new URL(`./assets/models/${selectedModel}`, window.location.href).href;
  }
  if (url.endsWith('/assets/models/Textures/colormap.png') || url.endsWith('/assets/models/objects/Textures/colormap.png')) {
    return new URL('./assets/textures/colormap.png', window.location.href).href;
  }
  return url;
});

// The tree GLB is authored in tiny model units (~2 units tall), while the
// character models in this scene are intentionally rendered around 50x.
// Keep the server's 0.7..1.0 tree scale authoritative, but normalize the
// source tree once so its visual size matches the game's world scale.
const originalLoad = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
  return originalLoad.call(this, url, (gltf) => {
    if (typeof url === 'string' && /\/assets\/models\/objects\/tree\.glb(?:$|[?#])/.test(url)) {
      gltf.scene.scale.setScalar(50);
      gltf.scene.traverse(child => {
        if (!child.isMesh) return;
        const material = Array.isArray(child.material) ? child.material[0] : child.material;
        if (material?.map) window.__echoTreeTexture = material.map;
      });
    }
    onLoad?.(gltf);
  }, onProgress, onError);
};

// The custom tree shader also needs the GLB's original UV-mapped color atlas.
// Inject it at render time so the depth/occlusion shader stays untouched.
const originalRender = THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render = function (scene, camera) {
  scene.traverse(object => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material.uniforms?.uOpacity || material.userData?.echoTreeTexturePatched) continue;
      if (material.uniforms.uOpacity.value !== 0.30 || !material.vertexShader?.includes('vTreeNormal')) continue;
      const texture = window.__echoTreeTexture;
      if (!texture) continue;

      material.uniforms.uMap = { value: texture };
      material.vertexShader = material.vertexShader
        .replace('varying vec3 vTreeNormal;', 'varying vec3 vTreeNormal;\n      varying vec2 vTreeUv;')
        .replace('vTreeNormal = normalize(normalMatrix * normal);', 'vTreeNormal = normalize(normalMatrix * normal);\n        vTreeUv = uv;');
      material.fragmentShader = material.fragmentShader
        .replace('uniform float uOpacity;', 'uniform float uOpacity;\n      uniform sampler2D uMap;\n      varying vec2 vTreeUv;')
        .replace('vec3 treeColor = mix(shadowColor, lightColor, brightness);', 'vec3 treeColor = mix(shadowColor, lightColor, brightness);\n        vec4 texel = texture2D(uMap, vTreeUv);\n        treeColor *= texel.rgb * mix(0.70, 1.10, gradient);');
      material.userData.echoTreeTexturePatched = true;
      material.needsUpdate = true;
    }
  });
  return originalRender.call(this, scene, camera);
};

// The world snapshot can be emitted immediately when Socket.IO connects, before
// the game module finishes installing all of its listeners. Ask for it again
// shortly after connect so the shared tree layout is always received.
const originalIo = window.io;
if (typeof originalIo === 'function') {
  window.io = function (...args) {
    const socket = originalIo(...args);
    socket.on('connect', () => {
      setTimeout(() => {
        if (socket.connected) {
          const activityProfileId = window.localStorage?.getItem('echo.activityProfileId');
          const selectedModel = window.localStorage?.getItem('echo.selectedModel') || 'character-female-a.glb';
          socket.emit('echo:hello', { version: 1, skin: selectedModel, activityProfileId });
        }
      }, 150);
    });
    return socket;
  };
}
