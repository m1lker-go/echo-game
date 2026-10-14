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

// The Kenney model's default forward is opposite to the direction used by
// ECHO's movement rotation. Rotate the loaded character 180 degrees once;
// the existing per-frame rotation then makes the character face where it runs.
const originalLoad = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function patchedLoad(url, onLoad, onProgress, onError) {
  return originalLoad.call(this, url, (gltf) => {
    if (gltf?.scene) gltf.scene.rotation.y += Math.PI;
    if (onLoad) onLoad(gltf);
  }, onProgress, onError);
};
