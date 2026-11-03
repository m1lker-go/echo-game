// ECHO onboarding preview: self-contained arena mechanics, no multiplayer state.
export const TILE = 84;
export const WIDTH = 3 * TILE;
export const LENGTH = 1260;
export const WATER_START = 730;
export const WATER_END = 850;
export const STAGE_GATES = Object.freeze([172, 428, 636, 980, 1220]);
export const BOT_ENERGIES = Object.freeze([9, 12, 15]);
export const STAGE_DESCRIPTIONS = Object.freeze([
  {title:'НАУЧИСЬ ДВИГАТЬСЯ', tip:'Пройди вперёд к светящейся отметке.', objective:'Пройденное расстояние', target:126},
  {title:'СОБЕРИ ЭНЕРГИЮ', tip:'Подбирай белые светящиеся точки. Каждая добавляет 1 энергию.', objective:'Собрано энергии', target:10},
  {title:'ИСПОЛЬЗУЙ РЫВОК', tip:'Нажми «РЫВОК» и доберись до следующей отметки.', objective:'Рывок и отметка', target:1},
  {title:'ПЕРЕПРЫГНИ ВОДУ', tip:'Вода отнимает энергию. Подойди к берегу и нажми «ПРЫЖОК».', objective:'Перепрыгни водную преграду', target:1},
  {title:'ПОБЕДИ ТРЁХ ПРОТИВНИКОВ', tip:'У кого больше энергии — тот побеждает. Выбери верный порядок: 9, 12, 15.', objective:'Побеждено противников', target:3}
]);
export function worldFromTrack(progress, lateral=0) {
  return { x:(lateral-progress)/Math.SQRT2, y:(-lateral-progress)/Math.SQRT2 };
}
export function trackFromWorld(x,y) {
  return { progress:-(x+y)/Math.SQRT2, lateral:(x-y)/Math.SQRT2 };
}
export function boundToCorridor(x,y,gate=STAGE_GATES[4]) {
  const t=trackFromWorld(x,y);
  return worldFromTrack(Math.max(0,Math.min(gate,t.progress)),Math.max(-WIDTH/2+24,Math.min(WIDTH/2-24,t.lateral)));
}
export function shuffledEnemies(random=Math.random) {
  const result=[...BOT_ENERGIES];
  for(let i=result.length-1;i>0;i--){const j=Math.min(i,Math.floor(random()*(i+1)));[result[i],result[j]]=[result[j],result[i]];}
  return result;
}
export function outcome(ours,enemy) {
  if(!Number.isFinite(ours)||!BOT_ENERGIES.includes(enemy))throw new Error('Invalid tutorial fight');
  return ours>enemy?{win:true,energy:ours+Math.round(enemy*.30),gained:Math.round(enemy*.30)}:{win:false,energy:0,gained:0};
}
export const FOOD_PLACEMENTS=Object.freeze([
  [206,-55],[220,12],[239,63],[258,-20],[280,38],
  [301,-57],[317,4],[338,60],[364,-32],[386,20]
]);