// ECHO: finger-controlled animated WebP. This is frame scrubbing, NOT autonomous playback.
const root=document.querySelector('#echo-pack-3d');
if(root){
 const canvas=root.querySelector('#echo-pack-3d-canvas'),ctx=canvas.getContext('2d',{alpha:false});
 const tip=root.querySelector('#echo-pack-3d-hint'),bar=root.querySelector('#echo-pack-3d-bar');
 const closeButton=root.querySelector('#echo-pack-3d-close'),resetButton=root.querySelector('#echo-pack-3d-reset');
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
  if(frames<=1)return;
  info(progress>=1?'Пак открыт! Нажми «Повторить», чтобы открыть ещё раз.':
    progress>0?'Останови палец — кадр замрёт. Проведи дальше, чтобы продолжить.':
    'Проведи по паку слева направо. Скорость анимации зависит от пальца.');
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
  }catch(err){console.warn('[Echo Pack] WebP frame decode failed:',err);info('Не удалось прочитать кадр WebP. Проверь анимацию и обнови страницу.');}
  finally{busy=false;if(active&&token===generation&&wanted>=0&&!cache.has(wanted))queueMicrotask(pump);}
 }
 async function prepare(){
  if(decoder){active=true;requestFrame();return;}
  if(typeof ImageDecoder==='undefined'){
   info('Для покадрового открытия нужен браузер с поддержкой ImageDecoder (например, Chrome).');return;
  }
  const token=++generation;
  try{
   info('Загружаем кадры упаковки…');
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
  }catch(err){console.warn('[Echo Pack] Animation init failed',err);info('Анимированный WebP не удалось открыть покадрово: '+err.message);}
 }
 function reset(){progress=0;down=false;shown=cache.has(0)?0:-1;updateUI();requestFrame();}
 function open(){root.hidden=false;reset();resize();prepare();}
 function close(){root.hidden=true;down=false;active=false;}
 document.querySelectorAll('[data-echo-preview-pack]').forEach(b=>b.addEventListener('click',open));
 closeButton.addEventListener('click',close);
 resetButton.addEventListener('click',reset);
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden)close()});
 function packWidth(){
  const css=canvas.getBoundingClientRect();
  return Math.min(css.width,css.height*(frameWidth/frameHeight));
 }
 canvas.addEventListener('pointerdown',e=>{
  if(root.hidden||!active||progress>=1)return;
  down=true;lastX=e.clientX;canvas.setPointerCapture(e.pointerId);e.preventDefault();
 });
 canvas.addEventListener('pointermove',e=>{
  if(!down)return;
  const dx=e.clientX-lastX;lastX=e.clientX;
  // Equal distance -> equal frame advancement; stationary finger -> frozen frame.
  progress=Math.max(progress,Math.min(1,progress+dx/Math.max(60,packWidth()*.85)));
  requestFrame();updateUI();e.preventDefault();
 });
 const release=()=>{down=false};
 canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
 window.addEventListener('resize',resize);
}
