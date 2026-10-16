// Shared virtual camera for the game world; HUD/control sizes are independent.
// Fixed vertical field of view: wider landscape displays reveal more world sideways.
// Two independent, height-relative scales:
// worldZoom=2 makes the world appear twice as close on EVERY aspect ratio;
// uiScale keeps HUD/menu typography at the original reference height.
export const UI_REFERENCE_HEIGHT = 700;
export const WORLD_ZOOM = 2;
export const WORLD_VIEW_HEIGHT = UI_REFERENCE_HEIGHT / WORLD_ZOOM;

export function getWorldViewport(pixelWidth, pixelHeight) {
  const physicalWidth = Math.max(1, Number(pixelWidth) || 1);
  const physicalHeight = Math.max(1, Number(pixelHeight) || 1);
  const scale = physicalHeight / WORLD_VIEW_HEIGHT;
  const uiScale = physicalHeight / UI_REFERENCE_HEIGHT;
  return {
    scale,
    uiScale,
    width: physicalWidth / scale,
    height: WORLD_VIEW_HEIGHT,
  };
}
