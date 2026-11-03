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
  assert.ok(html.includes('tutorial.js?v=echo-tutorial-2'));
  assert.ok(html.includes('modal.js?v=echo-round-result-3'));
  assert.ok(html.includes('style.css?v=echo-language-selector-3'));
  assert.ok(html.includes('ui-layout.css?v=echo-wasd-hint-scale-1'));
  assert.ok(html.includes('ТЕСТ ОБУЧЕНИЯ'));
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
  assert.ok(js.includes('Тестовый уровень: реальные паки пока не начисляются.'));
  assert.ok(!html.includes('class="tutorial-dialog"'),'all dialogs use ECHO modal system');
  assert.ok(js.includes("window.ECHOModal.alert"),'stage and result prompts use real modal');
  assert.ok(js.includes("buttonText:'ОК'"),'stage hints require OK');
  assert.ok(js.includes("closeOnBackdrop:false"),'cannot skip modal by tapping outside');
  assert.ok(js.includes("event.key==='Escape'"),'Escape must not skip a stage');
  assert.ok(js.includes("root.style.setProperty('--echo-ui-scale'"),'touch controls use game UI scaling');
  assert.ok(js.includes('if(state.locked)return;'),'stage cannot move behind modal');
  assert.ok(css.includes('.tutorial-reward-icons'));
});

test('isometric corridor advances down/right in screen space instead of vertically',async()=>{
  const t=await logic();
  const a=t.worldFromTrack(0,0),b=t.worldFromTrack(84,0);
  const iso={x:0.8660254,y:0.5};
  const sx=(b.x-a.x-(b.y-a.y))*iso.x;
  const sy=(b.x-a.x+b.y-a.y)*iso.y;
  assert.ok(sx>0 && sy>0,'forward movement is diagonal in iso projection');
  assert.ok(Math.abs(sx/sy)>1.1 && Math.abs(sx/sy)<2.2,'correct ECHO isometric angle');
  const half=t.WIDTH/2;
  const left=t.worldFromTrack(100,-half),right=t.worldFromTrack(100,half);
  assert.equal(Math.hypot(left.x-right.x,left.y-right.y),252,'corridor spans 3 tiles');
  assert.match(t.STAGE_DESCRIPTIONS[0].tip,/WASD.*стрелки.*джойстик/);
  assert.ok(!/9, 12, 15/.test(t.STAGE_DESCRIPTIONS[4].tip),
    'do not reveal the final puzzle solution in the stage modal');
});
