const MODEL_ASSETS = [
  'character-female-a.glb',
  'character-female-b.glb',
  'character-female-c.glb',
  'character-female-d.glb',
  'character-female-e.glb',
  'character-female-f.glb',
  'character-male-a.glb',
  'character-male-b.glb',
  'character-male-c.glb',
  'character-male-d.glb',
  'character-male-e.glb',
  'character-male-f.glb',
  'objects/patch-water-large.glb',
  'objects/patch-water.glb',
  'objects/stairs-corner-inner.glb',
  'objects/stairs-corner.glb',
  'objects/stairs.glb',
  'objects/tree-trunk.glb',
  'objects/tree.glb',
];

let started = false;

function preloadModels() {
  if (started) return;
  started = true;

  const baseUrl = new URL('./assets/models/', window.location.href);
  const preload = (file) => {
    const url = new URL(file, baseUrl).href;
    return fetch(url, { cache: 'force-cache', priority: 'low' }).catch(() => null);
  };

  async function run() {
    const queue = MODEL_ASSETS.slice();
    const workers = Array.from({ length: 2 }, async () => {
      while (queue.length) {
        const file = queue.shift();
        if (!file) return;
        await preload(file);
      }
    });
    await Promise.all(workers);
    console.log('[echo] model assets preloaded');
  }

  const start = () => { void run(); };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(start, { timeout: 1500 });
  } else {
    setTimeout(start, 800);
  }
}

// Warm the model files as soon as /echo/ is opened, including while the menu is visible.
preloadModels();
