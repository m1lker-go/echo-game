// Shared virtual camera for the game world only (HUD always uses real CSS pixels).
// Fixed vertical field of view: wider landscape displays reveal more world sideways.
export const WORLD_VIEW_HEIGHT = 700;

export function getWorldViewport(pixelWidth, pixelHeight) {
  const physicalWidth = Math.max(1, Number(pixelWidth) || 1);
  const physicalHeight = Math.max(1, Number(pixelHeight) || 1);
  const scale = physicalHeight / WORLD_VIEW_HEIGHT;
  return {
    scale,
    width: physicalWidth / scale,
    height: WORLD_VIEW_HEIGHT,
  };
}
