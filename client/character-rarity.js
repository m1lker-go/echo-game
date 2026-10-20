// Rarity is keyed by stable GLB filename, never by the localized display name.
export const CHARACTER_RARITY = Object.freeze({
  'character-female-a.glb': 'common',
  'character-female-b.glb': 'common',
  'character-female-c.glb': 'common',
  'character-female-d.glb': 'uncommon',
  'character-female-e.glb': 'common',
  'character-female-f.glb': 'common',
  'character-male-a.glb': 'common',
  'character-male-b.glb': 'uncommon',
  'character-male-c.glb': 'rare',
  'character-male-d.glb': 'rare',
  'character-male-e.glb': 'uncommon',
  'character-male-f.glb': 'uncommon',
  'character-ghost.glb': 'legendary',
  'character-keeper.glb': 'rare',
  'character-skeleton.glb': 'legendary',
  'character-zombie.glb': 'epic',
  'character-human.glb': 'rare',
  'character-orc.glb': 'epic',
});

export function getCharacterRarity(model) {
  return CHARACTER_RARITY[model] ?? null;
}
