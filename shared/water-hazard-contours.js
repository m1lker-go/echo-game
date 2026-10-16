// Ordered water hazard contours exported from water_hazard*.obj.
// Coordinates are in model X/Z; ECHO ground maps model X/Z onto world X/Y.
const ECHO_WATER_HAZARD_CONTOURS = {"patch-water.glb":[[-0.2,-0.6],[-0.3,-0.5732],[-0.3732,-0.5],[-0.4,-0.4],[-0.5,-0.3732],[-0.5732,-0.3],[-0.6,-0.2],[-0.6,0],[-0.5732,0.1],[-0.5,0.1732],[-0.4,0.2],[-0.3,0.2268],[-0.2268,0.3],[-0.2,0.4],[-0.1732,0.5],[-0.1,0.5732],[0,0.6],[0.1,0.5732],[0.1732,0.5],[0.2,0.4],[0.2268,0.3],[0.3,0.2268],[0.4,0.2],[0.5,0.1732],[0.5732,0.1],[0.6,0],[0.5732,-0.1],[0.5,-0.1732],[0.4,-0.2],[0.3,-0.2268],[0.2268,-0.3],[0.2,-0.4],[0.1732,-0.5],[0.1,-0.5732],[0,-0.6]],"patch-water-large.glb":[[-0.5,0.4],[-0.4732,0.5],[-0.4,0.5732],[-0.3,0.6],[-0.1,0.6],[0,0.5732],[0.0732,0.5],[0.1,0.4],[0.2,0.3732],[0.2732,0.3],[0.3,0.2],[0.5,0.2],[0.6,0.1732],[0.6732,0.1],[0.7,0],[0.6732,-0.1],[0.6,-0.1732],[0.5,-0.2],[0.1,-0.2],[0,-0.2268],[-0.0732,-0.3],[-0.1268,-0.5],[-0.2,-0.5732],[-0.3,-0.6],[-0.4,-0.5732],[-0.4732,-0.5],[-0.5,-0.4],[-0.6,-0.3732],[-0.6732,-0.3],[-0.7,-0.2],[-0.7,0],[-0.6732,0.1],[-0.6,0.1732],[-0.5,0.2]]};

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
  const boundaryEdges = [...edgeCounts.entries()].filter(([, count]) => count === 1).map(([key]) => key.split(':').map(Number));
  if (boundaryEdges.length < 3) return null;
  const adjacency = new Map();
  for (const [a, b] of boundaryEdges) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  const start = boundaryEdges[0][0];
  const ordered = [start];
  let previous = -1;
  let current = start;
  while (ordered.length <= boundaryEdges.length + 1) {
    const candidates = (adjacency.get(current) || []).filter((index) => index !== previous);
    const next = candidates.find((index) => index !== start) ?? (candidates.includes(start) ? start : null);
    if (next == null || next === start) break;
    ordered.push(next);
    previous = current;
    current = next;
  }
  return ordered.length >= 3 ? ordered.map((index) => vertices[index]) : null;
}

// On the Node/server side the triangulated OBJ is the source of truth for the
// large-water collision contour. The browser mirror is updated at runtime when
// the same OBJ is loaded as the visual surface.
if (typeof module !== 'undefined' && module.exports) {
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const objPath = path.join(__dirname, '..', 'client', 'assets', 'models', 'objects', 'water_hazard_large.obj');
    if (fs.existsSync(objPath)) {
      const contour = extractObjBoundary(fs.readFileSync(objPath, 'utf8'));
      if (contour) ECHO_WATER_HAZARD_CONTOURS['patch-water-large.glb'] = contour;
    }
  } catch (error) {
    console.warn('[water] failed to derive large contour from OBJ:', error.message);
  }
  module.exports = ECHO_WATER_HAZARD_CONTOURS;
}

export default ECHO_WATER_HAZARD_CONTOURS;
