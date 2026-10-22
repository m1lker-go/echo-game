// Classic bootstrap: runs in the document head before ECHO's Three.js modules.
// VK needs VKWebAppInit even when game modules or their CDNs load slowly.
(function () {
  'use strict';

  function signedVKParams() {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash.slice(1);
    const fragment = new URLSearchParams(hash.startsWith('?') ? hash.slice(1) : hash);
    for (const [name, value] of fragment) {
      if (!params.has(name)) params.set(name, value);
    }
    return Object.fromEntries([...params].filter(([name]) => name === 'sign' || name.startsWith('vk_')));
  }

  const launchParams = signedVKParams();
  let framedByVK = false;
  try {
    const refHost = new URL(document.referrer).hostname.toLowerCase();
    framedByVK = window.self !== window.top &&
      ['vk.com', 'vk.ru', 'vkontakte.ru'].some(host => refHost === host || refHost.endsWith('.' + host));
  } catch (_error) {}

  window.isVKMiniApp = Boolean(
    launchParams.vk_app_id || launchParams.vk_user_id ||
    launchParams.vk_platform || launchParams.sign || framedByVK ||
    /VkAndroidApp|VKMobile|VKontakte|VKCOM|VKMessenger/i.test(navigator.userAgent)
  );
  if (!window.isVKMiniApp) return;
  console.info('[echo vk mini] Early bootstrap started');

  function loadBridgeScript(src) {
    if (window.vkBridge?.send) return Promise.resolve(window.vkBridge);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      let finished = false;
      const timer = setTimeout(() => finish(new Error('VK Bridge CDN timed out')), 7000);

      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else {
          resolve(window.vkBridge);
        }
      }

      script.onload = () => finish(window.vkBridge?.send ? null : new Error('VK Bridge is unavailable'));
      script.onerror = () => finish(new Error('Cannot load VK Bridge from ' + src));
      document.head.appendChild(script);
    });
  }

  async function initialize() {
    let bridge = window.vkBridge;
    if (!bridge?.send) {
      const sources = [
        './vendor/vk-bridge-2.15.12.min.js',
        'https://unpkg.com/@vkontakte/vk-bridge@2.15.12/dist/browser.min.js',
        'https://cdn.jsdelivr.net/npm/@vkontakte/vk-bridge@2.15.12/dist/browser.min.js'
      ];
      let lastError;
      for (const src of sources) {
        try {
          bridge = await loadBridgeScript(src);
          console.info('[echo vk mini] Bridge loaded from', src);
          break;
        } catch (error) {
          lastError = error;
          console.warn('[echo vk mini] Bridge source unavailable', src, error);
        }
      }
      if (!bridge?.send) throw lastError || new Error('VK Bridge is unavailable');
    }

    let timer;
    try {
      await Promise.race([
        bridge.send('VKWebAppInit'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('VKWebAppInit timed out')), 10000);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
    console.info('[echo vk mini] VKWebAppInit OK');
    return bridge;
  }

  // Auth code awaits this shared promise instead of sending VKWebAppInit again.
  window.ECHOVKBridgeReady = initialize();
  window.ECHOVKBridgeReady.catch(error => {
    console.error('[echo vk mini] VK Bridge initialization failed', error);
  });
})();
