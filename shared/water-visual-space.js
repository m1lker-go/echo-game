// Server-authoritative mapping of an X/Z water model onto ECHO's isometric world.
// The model is rendered directly in screen XY: X rotation 90deg, then Z rotation
// water.rotation+90deg. The world collision outline must invert the ISO projection.
const ISO_X = 0.8660254;
const ISO_Y = 0.5;
const MODEL_SCALE = 50;

function localWaterPointToWorld(vertex, water) {
  const angle = (Number.isFinite(water.rotation) ? water.rotation : 0) + Math.PI / 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  const scale = MODEL_SCALE * water.scale;
  const screenX = scale * (vertex[0] * c + vertex[1] * s);
  const screenY = scale * (-vertex[0] * s + vertex[1] * c);
  return [
    water.x + (screenX / ISO_X + screenY / ISO_Y) / 2,
    water.y + (screenY / ISO_Y - screenX / ISO_X) / 2,
  ];
}

function worldPointToLocalWater(position, water) {
  const dx = position.x - water.x, dy = position.y - water.y;
  const screenX = (dx - dy) * ISO_X, screenY = (dx + dy) * ISO_Y;
  const angle = (Number.isFinite(water.rotation) ? water.rotation : 0) + Math.PI / 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  const scale = MODEL_SCALE * water.scale;
  return {
    x: (screenX * c - screenY * s) / scale,
    y: (screenX * s + screenY * c) / scale,
  };
}

function projectWaterContour(water, modelVertices) {
  return modelVertices.map(vertex => localWaterPointToWorld(vertex, water));
}

module.exports = { ISO_X, ISO_Y, MODEL_SCALE, localWaterPointToWorld, worldPointToLocalWater, projectWaterContour };
