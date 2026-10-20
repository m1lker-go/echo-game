// These character packs all reference Textures/colormap.png internally,
// but their actual texture atlases are different. Resolve by GLB filename.
const TEXTURE_BY_MODEL = Object.freeze({
  'character-ghost.glb': 'colormap1.png',
  'character-keeper.glb': 'colormap1.png',
  'character-skeleton.glb': 'colormap1.png',
  'character-zombie.glb': 'colormap1.png',
  'character-human.glb': 'variation-a.png',
  'character-orc.glb': 'variation-a.png',
});

export function createCharacterLoaderSelector(THREE, GLTFLoader, defaultLoader) {
  const loaders = new Map();
  return (file) => {
    const texture = TEXTURE_BY_MODEL[file];
    const atlas = texture || 'colormap.png';
    if (!loaders.has(atlas)) {
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        if (/\/Textures\/colormap\.png(?:[?#]|$)/i.test(url)) {
          return new URL(`./assets/textures/${atlas}`, document.baseURI).href;
        }
        return url;
      });
      loaders.set(atlas, new GLTFLoader(manager));
    }
    return loaders.get(atlas);
  };
}
