'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const labelsSource=fs.readFileSync(path.join(__dirname,'../../client/player-labels.js'),'utf8');
test('local speaking icon follows player number, never remote labels, and hides on release',async()=>{
  const callbacks=new Map(),draws=[];
  const ctx=new Proxy({},{
    get(obj,key){
      if(key in obj)return obj[key];
      if(key==='measureText')return ()=>({actualBoundingBoxAscent:10,actualBoundingBoxDescent:3});
      return (...args)=>{draws.push([key,...args]);};
    },
    set(obj,key,val){obj[key]=val;return true;}
  });
  const oldDoc=globalThis.document,oldStyle=globalThis.getComputedStyle,oldPerf=globalThis.performance;
  globalThis.document={documentElement:{},querySelector(){return null;},
    addEventListener(name,fn){callbacks.set(name,fn);}};
  globalThis.getComputedStyle=()=>({getPropertyValue(){return '';}});
  globalThis.performance={now:()=>1000};
  try{
    const {createPlayerLabels}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(labelsSource));
    const labels=createPlayerLabels({getContext:()=>ctx});
    labels.resize(800,400,1,1);
    const self={x:10,y:10,energy:80,name:'Me',visible:true,bounds:{top:40,bottom:-50}};
    const others=new Map([['enemy',{displayX:20,displayY:20,energy:90,name:'Them'}]]);
    const paint=()=>{
      draws.length=0;
      labels.render(self,others,0,0);
      return {waves:draws.filter(op=>op[0]==='arc').length,
        text:draws.filter(op=>op[0]==='fillText').map(op=>op[1])};
    };
    assert.equal(paint().waves,0,'no icon without active microphone');
    callbacks.get('echo:voice-self-speaking')({detail:{active:true}});
    assert.equal(paint().waves,2,'only one speaker icon despite another player');
    self.energy=120;
    assert.ok(paint().text.includes('120'),'local energy updates while speaking');
    callbacks.get('echo:voice-self-speaking')({detail:{active:false}});
    assert.equal(paint().waves,0,'indicator removed when transmission stops');
  }finally{
    globalThis.document=oldDoc;
    globalThis.getComputedStyle=oldStyle;
    globalThis.performance=oldPerf;
  }
});

test('voice badge module cache keys are updated so browsers and APK load the fix',()=>{
  const client=path.join(__dirname,'../../client');
  const game=fs.readFileSync(path.join(client,'game.js'),'utf8');
  const html=fs.readFileSync(path.join(client,'index.html'),'utf8');
  assert.ok(game.includes('player-labels.js?v=echo-labels-up-1-voice-1'));
  assert.ok(html.includes('game.js?v=echo-camera-jitter-1-voice-1'));
  assert.ok(html.includes('voice-ui.js?v=echo-voice-ui-6'));
});
