// iPhone / iPad Safari and VK WKWebView viewport sizing.
// The enclosing VK client owns the actual window; never attempt to expand it
// by inflating the page height. Use the space the iPhone truly exposes.
(function(){
  'use strict';
  const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  if(!ios)return;

  document.documentElement.classList.add('echo-ios-device');

  let pending=false;
  function sync(){
    pending=false;
    const layout=Number(window.innerHeight);
    const visual=Number(window.visualViewport?.height);
    // Avoid treating a missing/zero visual viewport as a zero-sized game.
    const valid=[layout,visual].filter(value=>Number.isFinite(value)&&value>0);
    if(!valid.length)return;
    const height=Math.min(...valid);
    document.documentElement.style.setProperty('--echo-ios-visible-height',height.toFixed(2)+'px');
    document.documentElement.classList.toggle('echo-ios-short-window',height<420);
    // Canvas and 3D camera already respond to window.resize; on iOS the
    // visible height can change without a layout viewport resize.
    if(document.readyState!=='loading'){
      window.dispatchEvent(new Event('echo:viewport-resized'));
    }
  }
  function schedule(){
    if(pending)return;
    pending=true;
    window.requestAnimationFrame(sync);
  }
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('orientationchange',schedule,{passive:true});
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  document.addEventListener('DOMContentLoaded',schedule,{once:true});
  schedule();
})();
