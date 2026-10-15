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
// Keep the server's tree scale authoritative, but normalize the source tree once.
const originalLoad = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
  return originalLoad.call(this, url, (gltf) => {
    if (typeof url === 'string' && /\/assets\/models\/objects\/tree\.glb(?:$|[?#])/.test(url)) {
      gltf.scene.scale.setScalar(50);
    }
    onLoad?.(gltf);
  }, onProgress, onError);
};

// The world snapshot can be emitted immediately when Socket.IO connects, before
// the game module finishes installing all of its listeners. Ask for it again
// shortly after connect so the shared tree layout is always received.
const originalIo = window.io;
if (typeof originalIo === 'function') {
  const gameSession = new URLSearchParams(window.location.search).get('play') === '1';
  window.io = function (...args) {
    if (!gameSession) {
      const noop = () => {};
      return {
        connected: false,
        id: null,
        on: noop,
        once: noop,
        off: noop,
        emit: noop,
        disconnect: noop,
        close: noop,
      };
    }
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

  // Explicitly terminate the game socket when leaving the page so the server
  // removes the player immediately instead of relying on page unload timing.
  window.addEventListener('pagehide', () => {
    const socket = window.echoSocket;
    if (socket?.connected) socket.disconnect();
  }, { once: true });
}
