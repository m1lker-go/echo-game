// Keep the map grid delicate without changing the projection or the world grid logic.
// game.js draws the baked field grid onto a dedicated 1024x1024 canvas.
const originalStroke = CanvasRenderingContext2D.prototype.stroke;
CanvasRenderingContext2D.prototype.stroke = function(...args) {
  const isFieldTexture = this.canvas?.width === 1024 && this.canvas?.height === 1024;
  const isFieldGrid = isFieldTexture && this.strokeStyle === 'rgba(169,198,228,.20)';
  if (!isFieldGrid) return originalStroke.apply(this, args);

  const previousStyle = this.strokeStyle;
  const previousWidth = this.lineWidth;
  this.strokeStyle = 'rgba(169,198,228,.11)';
  this.lineWidth = .75;
  try {
    return originalStroke.apply(this, args);
  } finally {
    this.strokeStyle = previousStyle;
    this.lineWidth = previousWidth;
  }
};
