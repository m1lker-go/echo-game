import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import WATER_GEOMETRY from './water-hazard-contours.js';

// Kenney Mini Characters reference Textures/colormap.png beside the GLB.
// Our project keeps the shared atlas in client/assets/textures/.
THREE.DefaultLoadingManager.setURLModifier((url) => {
  if (url.endsWith('/assets/models/Textures/colormap.png') || url.endsWith('/assets/models/objects/Textures/colormap.png')) {
    return new URL('./assets/textures/colormap.png', window.location.href).href;
  }
  return url;
});

function extractObjBoundary(text) {
  const vertices = [];
  const edgeCounts = new Map();

  const addEdge = (a, b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      vertices.push([Number(parts[1]), Number(parts[3])]);
      continue;
    }
    if (parts[0] !== 'f' || parts.length < 4) continue;

    const face = parts.slice(1).map((part) => {
      const rawIndex = Number(part.split('/')[0]);
      return rawIndex < 0 ? vertices.length + rawIndex : rawIndex - 1;
    }).filter((index) => Number.isInteger(index) && index >= 0 && index < vertices.length);

    for (let i = 1; i < face.length - 1; i += 1) {
      addEdge(face[0], face[i]);
      addEdge(face[i], face[i + 1]);
      addEdge(face[i + 1], face[0]);
    }
  }

  const adjacency = new Map();
  for (const key of edgeCounts.keys()) {
    const [a, b] = key.split(':').map(Number);
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }

  const boundaryEdges = [...edgeCounts.entries()]
    .filter(([, count]) => count === 1)
    .map(([key]) => key.split(':').map(Number));
  if (boundaryEdges.length < 3) return null;

  const boundaryAdjacency = new Map();
  for (const [a, b] of boundaryEdges) {
    if (!boundaryAdjacency.has(a)) boundaryAdjacency.set(a, []);
    if (!boundaryAdjacency.has(b)) boundaryAdjacency.set(b, []);
    boundaryAdjacency.get(a).push(b);
    boundaryAdjacency.get(b).push(a);
  }

  const start = boundaryEdges[0][0];
  const ordered = [start];
  let previous = -1;
  let current = start;

  while (ordered.length <= boundaryEdges.length + 1) {
    const candidates = (boundaryAdjacency.get(current) || []).filter((index) => index !== previous);
    const next = candidates.find((index) => index !== start) ?? (candidates.includes(start) ? start : null);
    if (next == null || next === start) break;
    ordered.push(next);
    previous = current;
    current = next;
  }

  if (ordered.length < 3) return null;
  return ordered.map((index) => vertices[index]);
}

async function loadLargeWaterFromObj(onLoad, onProgress, onError) {
  try {
    const response = await fetch('./assets/models/objects/water_hazard_large.obj');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const contour = extractObjBoundary(text);
    if (!contour) throw new Error('Could not extract water boundary from OBJ');

    // The same triangulated OBJ is now the visual large-water surface and the
    // contour used by the existing edge-aware water shader.
    WATER_GEOMETRY['patch-water-large.glb'] = contour;

    const object = new OBJLoader().parse(text);
    onLoad?.({ scene: object, animations: [] });
    onProgress?.({ loaded: text.length, total: text.length });
  } catch (error) {
    onError?.(error);
  }
}

// The tree GLB is authored in tiny model units (~2 units tall), while the
// character models in this scene are intentionally rendered around 50x.
// Keep the server's tree scale authoritative, but normalize the source tree once.
const originalLoad = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
  if (typeof url === 'string' && /\/assets\/models\/objects\/patch-water-large\.glb(?:$|[?#])/.test(url)) {
    void loadLargeWaterFromObj(onLoad, onProgress, onError);
    return this;
  }

  return originalLoad.call(this, url, (gltf) => {
    if (typeof url === 'string' && /\/assets\/models\/objects\/tree\.glb(?:$|[?#])/.test(url)) {
      gltf.scene.scale.setScalar(50);
    }
    onLoad?.(gltf);
  }, onProgress, onError);
};

// Water is rendered as a transparent surface behind the characters.
// Keep its existing render order, but restore depth testing so the water cannot
// draw over a character that is physically in front of it. The water itself
// stays at z=-1, while characters are rendered at z=0.
const originalRender = THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render = function (scene, camera) {
  if (scene?.isScene) {
    for (const object of scene.children) {
      if (object?.position?.z !== -1 || !object.children?.length) continue;
      object.renderOrder = -100;
      object.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        child.renderOrder = -100;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          // Water materials are already configured when created.
          // Avoid invalidating shaders every animation frame.
          if (material.depthTest !== true || material.depthWrite !== false) {
            material.depthTest = true;
            material.depthWrite = false;
            material.needsUpdate = true;
          }
        }
      });
    }
  }
  return originalRender.call(this, scene, camera);
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
