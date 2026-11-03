'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const client=path.join(__dirname,'../../client');
const read=(name)=>fs.readFileSync(path.join(client,name),'utf8');

async function logic(){
  return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(read('tutorial-logic.js')));
}
test('preview level is physically three 84-unit tiles wide and has five locked steps',async()=>{
  const t=await logic();
  assert.equal(t.TILE,84);
  assert.equal(t.WIDTH,252);
  assert.equal(t.STAGE_GATES.length,5);
  assert.equal(t.STAGE_DESCRIPTIONS.length,5);
  assert.equal(t.STAGE_DESCRIPTIONS[1].target,10);
  assert.equal(t.FOOD_PLACEMENTS.length,10);
  assert.equal(t.MOVE_TARGET,240);
  assert.ok(t.LENGTH>=2000,'corridor should span about two thousand units');
  assert.ok(t.STAGE_GATES[0]>=t.MOVE_TARGET+40,'first section is longer');
  assert.ok(t.STAGE_GATES[1]-t.STAGE_GATES[0]>=500,'food stage has room to explore');
  assert.ok(t.STAGE_GATES[2]-t.STAGE_GATES[1]>=350,'dash section is longer');
  assert.ok(t.STAGE_GATES[3]-t.STAGE_GATES[2]>=400,'water approach remains long');
  assert.ok(t.STAGE_GATES[4]-t.STAGE_GATES[3]>=280,'final fight has its own area');
  assert.ok(t.BOT_PROGRESS>t.STAGE_GATES[3]+150,'bots are further along the track');
  assert.ok(t.RETRY_PROGRESS>t.STAGE_GATES[3],'retry begins inside final section');
  assert.ok(t.FOOD_PLACEMENTS[0][0]>t.STAGE_GATES[0]&&t.FOOD_PLACEMENTS.at(-1)[0]<t.STAGE_GATES[1]);
  assert.ok(t.JUMP_LINE<t.WATER_START && t.JUMP_LINE>t.STAGE_GATES[2]);
  assert.ok(t.JUMP_LINE+420*.99 >t.WATER_END+16,'normal energy jump clears water');
  assert.ok(t.STAGE_GATES[4]<=2100,'shared movement module must not clamp the last section');
  const min=t.boundToCorridor(-1000,2000,t.STAGE_GATES[0]);
  const bounded=t.trackFromWorld(min.x,min.y);
  assert.ok(bounded.progress<=172 && bounded.progress>=0);
  assert.ok(Math.abs(bounded.lateral)<=102);
  const p=t.worldFromTrack(735,76);
  const back=t.trackFromWorld(p.x,p.y);
  assert.ok(Math.abs(back.progress-735)<1e-9);
  assert.ok(Math.abs(back.lateral-76)<1e-9);
});
test('enemy order changes and 10 energy wins only in 9 -> 12 -> 15 order',async()=>{
  const t=await logic();
  assert.deepEqual(t.shuffledEnemies(()=>0),[12,15,9]);
  let current=10;
  for(const enemy of [9,12,15]){
    const result=t.outcome(current,enemy);
    assert.equal(result.win,true);
    current=result.energy;
  }
  assert.equal(current,22);
  assert.equal(t.outcome(10,12).win,false);
  assert.equal(t.outcome(10,15).win,false);
  assert.equal(t.outcome(13,15).win,false);
  assert.throws(()=>t.outcome(10,999),/Invalid tutorial fight/);
});
test('standalone preview is explicitly opt-in, does not issue real rewards or enter live rooms',()=>{
  const html=read('tutorial.html'),js=read('tutorial.js'),css=read('tutorial.css');
  assert.ok(html.includes('tutorial.js?v=echo-tutorial-5'));
  assert.ok(html.includes('i18n.js?v=echo-hero-progress-1'));
  assert.ok(js.includes("await window.ECHO_I18N_READY"));
  assert.ok(js.includes("player-labels.js?v=echo-labels-up-1-voice-1-tutorial-names-1"));
  assert.ok(html.includes('daily-quests.css?v=echo-quest-status-sort-1'));
  assert.ok(html.includes('class="echo-quest-hud tutorial-task"'));
  assert.ok(html.includes('class="echo-quest-hud-name"'));
  assert.ok(html.includes('class="echo-quest-hud-action" disabled'));
  assert.ok(js.includes("dot.className='echo-quest-dot'"));
  assert.ok(!css.includes('#game .tutorial-task{'),'no custom top offset overrides shared quest HUD');
  assert.match(read('daily-quests.css'),/#game \.echo-quest-hud\{position:absolute;z-index:12;top:max\(5px,env\(safe-area-inset-top\)\)/);
  assert.ok(html.includes('modal.js?v=echo-round-result-3'));
  assert.ok(html.includes('style.css?v=echo-language-selector-3'));
  assert.ok(html.includes('ui-layout.css?v=echo-wasd-hint-scale-1'));
  assert.ok(html.includes('<title>ECHO — тестовое обучение</title>'));
  assert.ok(js.includes("from './tutorial-logic.js'"));
  assert.ok(js.includes('role')===false || html.includes('aria-live="polite"'));
  assert.ok(!js.includes('socket.io') && !js.includes('echo:hello') && !js.includes('/api/packs/free'));
  assert.ok(js.includes("if(!battle.win)"));
  assert.ok(js.includes('resetFinalChallenge'));
  assert.ok(!js.includes('state.models.delete(id)'), 'a retry must reuse loaded character models');
  assert.ok(js.includes('WATER_START') && js.includes('WATER_END'));
  assert.ok(js.includes('state.jumpFrom<WATER_START && state.jumpTo>WATER_END'));
  assert.ok(css.includes('#game[data-tutorial-stage="2"] #boost'));
  assert.ok(css.includes('#game[data-tutorial-stage="3"] #jump'));
  assert.ok(js.includes("tr('reward_note'"),'test reward disclaimer must be localized');
  assert.ok(!js.includes('showToast('), 'tutorial must not trigger any short toasts');
  assert.ok(!html.includes('tutorial-toast'), 'tutorial toast overlay removed');
  assert.ok(!css.includes('.tutorial-toast'), 'toast styles removed');
  assert.ok(js.includes('taskProgress.textContent='), 'real HUD remains responsible for live progress');
  assert.ok(js.includes("showStage({intro:true})"),'initial movement tutorial is introduced once');
  assert.ok(js.includes("if(intro)void hintModal(lesson('title',0),lesson('tip',0));"),
    'subsequent stages must never interrupt with modals');
  assert.ok(js.includes("showObjectiveHint('water_warning'"),'water warning stays in HUD');
  assert.ok(!js.includes("void hintModal('"),'no error modal interrupts walking');
  assert.ok(js.includes("updateCharacterFacing(model.root,state.x-botWorld.x,state.y-botWorld.y,ISO)"),
    'stationary enemies face the current hero using the real isometric model system');
  assert.ok(!js.includes("model.root.rotation.y=Math.PI"),'fixed backward facing removed');
  assert.ok(js.includes('hideName:true'),'training labels show numbers without names');
  assert.ok(!html.includes('class="tutorial-dialog"'),'all dialogs use ECHO modal system');
  assert.ok(js.includes("window.ECHOModal.alert"),'stage and result prompts use real modal');
  assert.ok(js.includes("buttonText:tr('ok','ОК')"),'starting hint uses localized OK');
  assert.ok(js.includes("closeOnBackdrop:false"),'cannot skip modal by tapping outside');
  assert.ok(js.includes("event.key==='Escape'"),'Escape must not skip a stage');
  assert.ok(js.includes("root.style.setProperty('--echo-ui-scale'"),'touch controls use game UI scaling');
  assert.ok(js.includes('if(state.locked)return;'),'stage cannot move behind modal');
  assert.ok(css.includes('.tutorial-reward-icons'));
});

test('isometric corridor advances from bottom-left to top-right',async()=>{
  const t=await logic();
  const a=t.worldFromTrack(0,0),b=t.worldFromTrack(84,0);
  const iso={x:0.8660254,y:0.5};
  const sx=(b.x-a.x-(b.y-a.y))*iso.x;
  const sy=(b.x-a.x+b.y-a.y)*iso.y;
  assert.ok(sx>0 && sy<0,'forward movement goes right and UP on the screen');
  assert.ok(Math.abs(sx/sy)>1.1 && Math.abs(sx/sy)<2.2,'correct ECHO isometric angle');
  const half=t.WIDTH/2;
  const left=t.worldFromTrack(100,-half),right=t.worldFromTrack(100,half);
  assert.equal(Math.hypot(left.x-right.x,left.y-right.y),252,'corridor spans 3 tiles');
  assert.match(t.STAGE_DESCRIPTIONS[0].tip,/WASD.*стрелки.*джойстик/);
  assert.ok(!/9, 12, 15/.test(t.STAGE_DESCRIPTIONS[4].tip),
    'do not reveal the final puzzle solution in the stage modal');
});


test('all training UI texts are translated by the exact ECHO ru/en dictionaries',()=>{
  const locales=['ru','en'].map(lang=>JSON.parse(read('locales/'+lang+'.json')));
  const expected=['title','back','controls','rotate','step','remaining','ok',
    'jump_early','water_warning','water_retry','gate','hero','win','lose',
    'lose_text','retry','reward','reward_note','pack_alt','claim'];
  for(const locale of locales){
    const words=locale.game.tutorial;
    for(const key of expected){
      assert.equal(typeof words[key],'string',key+' missing');
      assert.ok(words[key].length>=2,key+' empty');
    }
    for(const name of ['movement','energy','dash','water','battle']){
      for(const key of ['title','tip','objective'])assert.equal(typeof words.stages[name][key],'string');
    }
  }
  assert.match(locales[0].game.tutorial.stages.movement.tip,/WASD.*стрелки.*джойстик/);
  assert.match(locales[1].game.tutorial.stages.movement.tip,/WASD.*arrow.*joystick/i);
  assert.notEqual(locales[0].game.tutorial.stages.water.title,locales[1].game.tutorial.stages.water.title);
  const source=read('tutorial.js');
  assert.ok(source.includes('refreshStaticText()'));
  assert.ok(source.includes("document.addEventListener('echo:language-changed'"));
  assert.ok(source.includes("stageIds=['movement','energy','dash','water','battle']"));
  assert.ok(source.includes("lesson('objective',stage)"));
});

test('training enemy labels render energy only; original PvP still renders names',async()=>{
  const source=read('player-labels.js');
  assert.ok(source.includes('player.hideName === true'));
  const eventHandlers=new Map(),drawn=[];
  const ctx=new Proxy({},{
    get(target,key){
      if(key in target)return target[key];
      if(key==='measureText')return ()=>({actualBoundingBoxAscent:10,actualBoundingBoxDescent:3});
      return (...args)=>{drawn.push([key,...args]);};
    },
    set(obj,key,val){obj[key]=val;return true;}
  });
  const oldDoc=globalThis.document,oldStyle=globalThis.getComputedStyle;
  globalThis.document={documentElement:{},querySelector(){return null;},
    addEventListener(name,fn){eventHandlers.set(name,fn);}};
  globalThis.getComputedStyle=()=>({getPropertyValue(){return '';}});
  try{
    const {createPlayerLabels}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
    const labels=createPlayerLabels({getContext:()=>ctx});
    labels.resize(800,400,1,1);
    const self={x:0,y:0,energy:10,name:'Hero',visible:true};
    const others=new Map([['bot',{displayX:50,displayY:0,energy:9,name:'Bot',hideName:true}]]);
    labels.render(self,others,0,0);
    assert.ok(drawn.some(c=>c[0]==='fillText'&&c[1]==='9'));
    assert.ok(drawn.some(c=>c[0]==='fillText'&&c[1]==='Hero'));
    assert.ok(!drawn.some(c=>c[0]==='fillText'&&c[1]==='Bot'),'training bot name is hidden');
    drawn.length=0;
    others.get('bot').hideName=false;
    labels.render(self,others,0,0);
    assert.ok(drawn.some(c=>c[0]==='fillText'&&c[1]==='Bot'),'real PVP names remain visible');
  }finally{
    globalThis.document=oldDoc;globalThis.getComputedStyle=oldStyle;
  }
});
