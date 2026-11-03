// ECHO onboarding preview: self-contained arena mechanics, no multiplayer state.
export const TILE = 84;
export const WIDTH = 3 * TILE;
export const LENGTH = 2080;
export const WATER_START = 1420;
export const WATER_END = 1540;
export const STAGE_GATES = Object.freeze([300, 840, 1240, 1740, 2040]);
// All stage landmarks share one geometry source, preventing gaps or impossible jumps.
export const MOVE_TARGET = 240;
export const BOOST_TARGET = 1120;
export const BOT_PROGRESS = 1940;
export const RETRY_PROGRESS = 1760;
export const JUMP_LINE = WATER_START - 75;
export const STAGE_MARKERS = Object.freeze([MOVE_TARGET, 785, BOOST_TARGET, JUMP_LINE]);
export const BOT_ENERGIES = Object.freeze([9, 12, 15]);
export const STAGE_DESCRIPTIONS = Object.freeze([
  {title:'ДВИЖЕНИЕ', tip:'Для движения используй WASD, стрелки на клавиатуре или джойстик на мобильном. Пройди к светящейся отметке.', objective:'Пройденное расстояние', target:MOVE_TARGET},
  {title:'СОБЕРИ ЭНЕРГИЮ', tip:'Подбирай белые светящиеся точки. Каждая добавляет 1 энергию.', objective:'Собрано энергии', target:10},
  {title:'РЫВОК', tip:'Нажми «РЫВОК» и доберись до следующей отметки.', objective:'Рывок и отметка', target:1},
  {title:'ПРЫЖОК', tip:'Вода отнимает энергию. Подойди к берегу и нажми «ПРЫЖОК».', objective:'Перепрыгни воду', target:1},
  {title:'ПОБЕДИ ВСЕХ', tip:'У кого больше энергии — тот побеждает. Выбирай соперников так, чтобы набрать достаточно энергии для победы над всеми тремя.', objective:'Побеждено противников', target:3}
]);
export function worldFromTrack(progress, lateral=0) {
  // Positive progress moves right and UP in ECHO's isometric projection.
  // The perpendicular lane axis preserves the corridor's full 3 x 84 width.
  return { x:lateral, y:-progress };
}
export function trackFromWorld(x,y) {
  return { progress:-y, lateral:x };
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
  [350,-65],[395,25],[442,70],[484,-15],[530,52],
  [575,-72],[628,8],[683,74],[729,-42],[785,22]
]);