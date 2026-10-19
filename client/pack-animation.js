// ECHO: finger-controlled animated WebP. This is frame scrubbing, NOT autonomous playback.
const root=document.querySelector('#echo-pack-3d');
if(root){
 const canvas=root.querySelector('#echo-pack-3d-canvas'),ctx=canvas.getContext('2d',{alpha:false});
 const tip=root.querySelector('#echo-pack-3d-hint'),bar=root.querySelector('#echo-pack-3d-bar');
 const closeButton=root.querySelector('#echo-pack-3d-close'),resetButton=root.querySelector('#echo-pack-3d-reset');
 const handle=root.querySelector('#echo-pack-tear-handle');
 let hintTimer=null,toastTimer=null,hintIndex=0;
 const tr=(key,fallback)=>window.$t?.('menu:'+key,fallback)??fallback;
 const hints=['pack_hint_0','pack_hint_1','pack_hint_2','pack_hint_3','pack_hint_4'];
 function showHint(message){clearTimeout(toastTimer);tip.textContent=message;tip.classList.remove('is-left','is-right');tip.classList.add(hintIndex%2===0?'is-left':'is-right');tip.classList.add('is-visible');toastTimer=setTimeout(()=>tip.classList.remove('is-visible'),2600);}
 function beginHints(){clearInterval(hintTimer);hintIndex=0;showHint(tr(hints[0],'Открой пак! ✨'));hintTimer=setInterval(()=>{if(!root.hidden&&progress<1){hintIndex++;showHint(tr(hints[hintIndex%hints.length],''));}},5500);}
 const source='./assets/packs/basiccard.webp';
 let decoder=null,frames=1,progress=0,active=false,busy=false,wanted=-1,shown=-1,down=false,lastX=0;
 let generation=0,frameWidth=2,frameHeight=3;
 const cache=new Map(),MAX_CACHE=14;
 function resize(){
  const rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
  const w=Math.max(1,Math.round(rect.width*ratio)),h=Math.max(1,Math.round(rect.height*ratio));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;draw();}
 }
 function draw(){
  const w=canvas.width,h=canvas.height;
  ctx.fillStyle='#07101e';ctx.fillRect(0,0,w,h);
  const frame=cache.get(shown);
  if(!frame)return;
  const scale=Math.min(w/frameWidth,h/frameHeight);
  const dw=frameWidth*scale,dh=frameHeight*scale;
  ctx.drawImage(frame,(w-dw)/2,(h-dh)/2,dw,dh);
 }
 function info(message){tip.textContent=message}
 function updateUI(){
  bar.style.width=(progress*100).toFixed(1)+'%';
  handle.style.left=(13+progress*74)+'%';
  handle.hidden=progress>=1;
  if(progress>=1){resetButton.hidden=false;clearInterval(hintTimer);showHint(tr('pack_hint_done','Пак открыт! 🎉'));}
 }
 function requestFrame(){
  if(!active||!decoder)return;
  wanted=Math.max(0,Math.min(frames-1,Math.round(progress*(frames-1))));
  if(cache.has(wanted)){shown=wanted;draw();return;}
  pump();
 }
 async function pump(){
  if(busy||!active||!decoder)return;
  busy=true;const token=generation;
  try{
   while(active&&token===generation&&!cache.has(wanted)){
    const index=wanted;
    const result=await decoder.decode({frameIndex:index,completeFramesOnly:true});
    const bitmap=result.image;
    if(token!==generation){bitmap.close();break;}
    frameWidth=bitmap.displayWidth;frameHeight=bitmap.displayHeight;
    cache.set(index,bitmap);
    // Preserve the opening frame and a small sliding window for mobile memory.
    while(cache.size>MAX_CACHE){
     const candidate=[...cache.keys()].find(k=>k!==0&&k!==wanted);
     if(candidate===undefined)break;
     cache.get(candidate).close();cache.delete(candidate);
    }
    if(index===wanted){shown=index;draw();}
   }
  }catch(err){console.warn('[Echo Pack] WebP frame decode failed:',err);info(tr('pack_decode_failed','Не удалось прочитать кадр WebP. Проверь анимацию и обнови страницу.'));}
  finally{busy=false;if(active&&token===generation&&wanted>=0&&!cache.has(wanted))queueMicrotask(pump);}
 }
 async function prepare(){
  if(decoder){active=true;requestFrame();return;}
  if(typeof ImageDecoder==='undefined'){
   info(tr('pack_decoder_unsupported','Для покадрового открытия нужен браузер с поддержкой ImageDecoder (например, Chrome).'));return;
  }
  const token=++generation;
  try{
   info(tr('pack_loading','Загружаем кадры упаковки…'));
   const response=await fetch(source,{cache:'force-cache'});
   if(!response.ok)throw new Error('HTTP '+response.status);
   const bytes=await response.arrayBuffer();
   if(token!==generation)return;
   const next=new ImageDecoder({data:new Uint8Array(bytes),type:'image/webp',preferAnimation:true});
   await next.tracks.ready;
   if(token!==generation){next.close();return;}
   const track=next.tracks.selectedTrack;
   if(!track||!Number.isInteger(track.frameCount)||track.frameCount<2){
    next.close();throw new Error('basiccard.webp is not recognized as animated WebP');
   }
   decoder=next;frames=track.frameCount;active=true;requestFrame();updateUI();
  }catch(err){console.warn('[Echo Pack] Animation init failed',err);info(tr('pack_init_failed','Анимированный WebP не удалось открыть покадрово.'));}
 }
 function reset(){progress=0;down=false;shown=cache.has(0)?0:-1;resetButton.hidden=true;updateUI();requestFrame();beginHints();}
 function open(){root.hidden=false;reset();resize();prepare();}
 function close(){root.hidden=true;down=false;active=false;clearInterval(hintTimer);clearTimeout(toastTimer);}
 document.querySelectorAll('[data-echo-preview-pack]').forEach(b=>b.addEventListener('click',open));
 closeButton.addEventListener('click',close);
 resetButton.addEventListener('click',reset);
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden)close()});
 // Tear can start only on the blue handle, not anywhere on the canvas.
 handle.addEventListener('pointerdown',e=>{
  if(root.hidden||!active||progress>=1)return;
  down=true;lastX=e.clientX;handle.setPointerCapture(e.pointerId);e.preventDefault();showHint(tr('pack_hint_drag','Тяни вправо! 👉'));
 });
 handle.addEventListener('pointermove',e=>{
  if(!down)return;
  const rect=root.querySelector('.echo-pack-view').getBoundingClientRect();
  const dx=e.clientX-lastX;lastX=e.clientX;
  progress=Math.max(progress,Math.min(1,progress+dx/Math.max(60,rect.width*.74)));
  requestFrame();updateUI();e.preventDefault();
 });
 const release=()=>{down=false};
 handle.addEventListener('pointerup',release);handle.addEventListener('pointercancel',release);
 document.addEventListener('echo:language-changed',()=>{if(!root.hidden)showHint(progress>=1?tr('pack_hint_done','Пак открыт! 🎉'):tr(hints[hintIndex%hints.length],''));});
 window.addEventListener('resize',resize);
}
