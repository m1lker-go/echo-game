import * as THREE from 'three';

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
