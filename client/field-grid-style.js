// Keep the map grid crisp by rendering it only on the existing 2D world canvas.
// The Three.js field texture is deliberately stripped of its duplicate baked grid:
// a 1024px texture stretched over 4200 world units is filtered by WebGL and becomes
// soft/thick. The original #world canvas already draws the same isometric lattice
// in screen space, where it stays 1px and pixel-crisp.
const worldCanvas = document.querySelector('#world');
if (worldCanvas) worldCanvas.style.zIndex = '2';

const originalStroke = CanvasRenderingContext2D.prototype.stroke;
const originalFillRect = CanvasRenderingContext2D.prototype.fillRect;

CanvasRenderingContext2D.prototype.stroke = function(...args) {
  const isFieldTexture = this.canvas?.width === 1024 && this.canvas?.height === 1024;
  const isFieldGrid = isFieldTexture && this.strokeStyle === 'rgba(169,198,228,.20)';
  if (!isFieldGrid) return originalStroke.apply(this, args);
  return undefined;
};

CanvasRenderingContext2D.prototype.fillRect = function(...args) {
  const isFieldTexture = this.canvas?.width === 1024 && this.canvas?.height === 1024;
  const isFieldGridPoint = isFieldTexture && this.fillStyle === 'rgba(195,222,247,.22)';
  if (!isFieldGridPoint) return originalFillRect.apply(this, args);
  return undefined;
};
