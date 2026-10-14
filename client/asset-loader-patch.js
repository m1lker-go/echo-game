import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Kenney Mini Characters reference Textures/colormap.png beside the GLB.
// Our project keeps the shared atlas in client/assets/textures/.
THREE.DefaultLoadingManager.setURLModifier((url) => {
  if (url.endsWith('/assets/models/Textures/colormap.png')) {
    return new URL('./assets/textures/colormap.png', window.location.href).href;
  }
  return url;
});

// Align the Kenney model's default forward with ECHO's movement direction.
// Keep the correction at 90 degrees; the existing per-frame rotation then
// turns the character to face the direction it is actually running.
const originalLoad = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function patchedLoad(url, onLoad, onProgress, onError) {
  return originalLoad.call(this, url, (gltf) => {
    if (gltf?.scene) gltf.scene.rotation.y += Math.PI / 2;
    if (onLoad) onLoad(gltf);
  }, onProgress, onError);
};
