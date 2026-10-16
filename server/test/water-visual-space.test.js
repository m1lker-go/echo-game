const test = require('node:test');
const assert = require('node:assert/strict');
const geometry = require('../../shared/water-hazard-contours');
const {
  ISO_X, ISO_Y, MODEL_SCALE, worldPointToLocalWater, projectWaterContour,
} = require('../../shared/water-visual-space');

for (const [model, points] of Object.entries(geometry)) {
  test(model + ': server outline exactly matches the rendered water mesh', () => {
    for (const rotation of [0, .2, .75, 1.57, 2.45, 3.9, 5.8]) {
      for (const scale of [7, 10, 12]) {
        const water = { model, x: 123.125, y: -786.75, scale, rotation };
        const vertices = projectWaterContour(water, points);
        assert.equal(vertices.length, points.length);
        const angle = rotation + Math.PI / 2;
        const c = Math.cos(angle), s = Math.sin(angle);
        for (let i = 0; i < points.length; i++) {
          const [x, z] = points[i];
          // Independent Three.js visual pipeline: OBJ XZ -> rotate X -> rotate Z.
          const visualX = MODEL_SCALE * scale * (c * x + s * z);
          const visualY = MODEL_SCALE * scale * (-s * x + c * z);
          const [wx, wy] = vertices[i];
          const screenX = (wx - water.x - (wy - water.y)) * ISO_X;
          const screenY = (wx - water.x + (wy - water.y)) * ISO_Y;
          assert.ok(Math.abs(visualX - screenX) < 1e-8, 'visible X and collision X differ');
          assert.ok(Math.abs(visualY - screenY) < 1e-8, 'visible Y and collision Y differ');
          const local = worldPointToLocalWater({ x: wx, y: wy }, water);
          assert.ok(Math.abs(local.x - x) < 1e-10);
          assert.ok(Math.abs(local.y - z) < 1e-10);
        }
      }
    }
  });
}
