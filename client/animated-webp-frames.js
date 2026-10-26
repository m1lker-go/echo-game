// Decode animated WebP into small cached canvases once.
// CanvasRenderingContext2D.drawImage(<img>) otherwise draws the poster/first
// WebP frame in several browsers, notably mobile WebKit.
const read24=(bytes,i)=>bytes[i]|(bytes[i+1]<<8)|(bytes[i+2]<<16);
const read32=(bytes,i)=>(bytes[i]|bytes[i+1]<<8|bytes[i+2]<<16|bytes[i+3]<<24)>>>0;
const fourCC=(bytes,i)=>String.fromCharCode(bytes[i],bytes[i+1],bytes[i+2],bytes[i+3]);
const put24=(bytes,i,n)=>{bytes[i]=n&255;bytes[i+1]=(n>>>8)&255;bytes[i+2]=(n>>>16)&255;};
const put32=(bytes,i,n)=>{bytes[i]=n&255;bytes[i+1]=(n>>>8)&255;bytes[i+2]=(n>>>16)&255;bytes[i+3]=(n>>>24)&255;};
const putFour=(bytes,i,s)=>{for(let j=0;j<4;j++)bytes[i+j]=s.charCodeAt(j);};

export function parseAnimatedWebp(buffer){
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  if(bytes.length<30||fourCC(bytes,0)!=='RIFF'||fourCC(bytes,8)!=='WEBP')
    throw new Error('Invalid WebP file');
  const fileEnd=Math.min(bytes.length,read32(bytes,4)+8);
  let width=0,height=0,frames=[],duration=0;
  for(let pos=12;pos+8<=fileEnd;){
    const name=fourCC(bytes,pos),size=read32(bytes,pos+4);
    const start=pos+8,end=start+size;
    if(end>fileEnd)throw new Error('Truncated WebP chunk');
    if(name==='VP8X'&&size>=10){
      width=read24(bytes,start+4)+1;
      height=read24(bytes,start+7)+1;
    }
    if(name==='ANMF'&&size>=16){
      const x=read24(bytes,start)*2,y=read24(bytes,start+3)*2;
      const w=read24(bytes,start+6)+1,h=read24(bytes,start+9)+1;
      const delay=Math.max(1,read24(bytes,start+12));
      const flags=bytes[start+15];
      const partStart=start+16;
      let hasAlpha=false,hasPixels=false;
      for(let part=partStart;part+8<=end;){
        const partName=fourCC(bytes,part),partSize=read32(bytes,part+4);
        const partEnd=part+8+partSize;
        if(partEnd>end)throw new Error('Invalid WebP frame payload');
        if(partName==='ALPH')hasAlpha=true;
        if(partName==='VP8 '||partName==='VP8L')hasPixels=true;
        part=partEnd+(partSize&1);
      }
      if(!hasPixels||!width||!height||x+w>width||y+h>height)
        throw new Error('Invalid animated WebP frame');
      frames.push({
        x,y,width:w,height:h,delay,elapsed:duration,
        blend:(flags&2)===0,
        dispose:(flags&1)!==0,
        alpha:hasAlpha,
        payload:bytes.subarray(partStart,end)
      });
      duration+=delay;
    }
    pos=end+(size&1);
  }
  if(!frames.length||!duration)throw new Error('No animated WebP frames');
  return {width,height,duration,frames};
}

// Each ANMF payload contains static ALPH/VP8 or VP8L chunks. Wrap it in an
// ordinary still WebP RIFF for decoding on Safari, Chrome and Android WebView.
export function makeStillWebp(frame){
  const payload=frame.payload;
  const vp8x=18,odd=payload.length&1;
  const size=12+vp8x+payload.length+odd;
  const bytes=new Uint8Array(size);
  putFour(bytes,0,'RIFF');put32(bytes,4,size-8);putFour(bytes,8,'WEBP');
  putFour(bytes,12,'VP8X');put32(bytes,16,10);
  bytes[20]=frame.alpha?16:0;
  put24(bytes,24,frame.width-1);
  put24(bytes,27,frame.height-1);
  bytes.set(payload,30);
  return bytes;
}

async function decodeStillWebp(bytes){
  const blob=new Blob([bytes],{type:'image/webp'});
  if(typeof createImageBitmap==='function'){
    try { const bitmap=await createImageBitmap(blob); return {image:bitmap,close:()=>bitmap.close()}; }
    catch(_){ /* Browser supports WebP but not ImageBitmap decoding. */ }
  }
  const url=URL.createObjectURL(blob);
  try {
    const image=new Image();
    image.src=url;
    await image.decode();
    return {image,close:()=>URL.revokeObjectURL(url)};
  }catch(error){
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function loadAnimatedWebpFrames(url,{outputSize=128}={}){
  const response=await fetch(url);
  if(!response.ok)throw new Error('WebP request failed: '+response.status);
  const animation=parseAnimatedWebp(await response.arrayBuffer());
  const {width,height,duration,frames}=animation;
  const compositor=document.createElement('canvas');
  compositor.width=width;compositor.height=height;
  const ctx=compositor.getContext('2d',{willReadFrequently:false});
  if(!ctx)throw new Error('2D context not available for WebP frames');
  const rendered=[];
  let last=null;
  for(const frame of frames){
    if(last?.dispose)ctx.clearRect(last.x,last.y,last.width,last.height);
    if(!frame.blend)ctx.clearRect(frame.x,frame.y,frame.width,frame.height);
    const decoded=await decodeStillWebp(makeStillWebp(frame));
    try {
      ctx.drawImage(decoded.image,frame.x,frame.y,frame.width,frame.height);
    }finally{decoded.close();}
    const snapshot=document.createElement('canvas');
    snapshot.width=outputSize;
    snapshot.height=outputSize;
    const drawCtx=snapshot.getContext('2d');
    if(!drawCtx)throw new Error('2D context not available for cached WebP frame');
    drawCtx.drawImage(compositor,0,0,outputSize,outputSize);
    rendered.push(snapshot);
    last=frame;
  }
  // All the food dots share these small decoded frames (~5 MB at 128px);
  // select by clock, not by HTMLImageElement animation behavior.
  const constantDelay=frames.every(frame=>frame.delay===frames[0].delay)?frames[0].delay:0;
  return {
    frameCount:rendered.length,
    duration,
    frameAt(milliseconds){
      const t=((milliseconds%duration)+duration)%duration;
      if(constantDelay)return rendered[Math.min(rendered.length-1,Math.floor(t/constantDelay))];
      let lo=0,hi=frames.length-1;
      while(lo<hi){
        const mid=(lo+hi)>>>1;
        if(t>=frames[mid].elapsed+frames[mid].delay)lo=mid+1;
        else hi=mid;
      }
      return rendered[lo];
    }
  };
}
