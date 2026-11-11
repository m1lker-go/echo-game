'use strict';

// Lightweight server-owned ECHO opponents. They are ordinary participants in
// movement, food and PvP, but have no Socket.IO connection, account or rewards.
const BOT_NAMES = Object.freeze(['Max', 'Tim', 'Bob', 'Alex', 'Leo']);
const BOT_SKINS = Object.freeze([
  'character-male-a.glb', 'character-female-c.glb',
  'character-male-b.glb', 'character-female-e.glb', 'character-male-c.glb'
]);
const BOT_COUNT = BOT_NAMES.length;
// More frequent grouped snapshots remove 250ms position jumps on the client.
const TICK_MS = 125;
const SKILL_JUMP_MS = 450;
const ENERGY_REJOIN_THRESHOLD = 200;
const EXHAUSTED_EXIT_MIN_MS = 6500;
const EXHAUSTED_EXIT_MAX_MS = 14500;
const NORMAL_RESPAWN_MIN_MS = 4500;
const NORMAL_RESPAWN_MAX_MS = 9500;

function createAiBots({
  players, getFood, spawn, isValidPosition, isWater = () => false,
  collectFood, checkForFights, broadcastPlayers, broadcastFood,
  halfSize = 2100, now = Date.now, random = Math.random
}) {
  const rooms = new Map();
  let lastTick = now();
  const rand = (min, max) => min + random() * (max - min);
  const keyOf = ({roundId,roomId}) => String(roundId) + ':' + String(roomId);
  const inRoom = (player, room) => player.roundId === room.roundId && player.roomId === room.roomId;
  const safePoint = p => isValidPosition(p) && !isWater(p);
  const capPosition = n => Math.max(-halfSize + 65, Math.min(halfSize - 65, n));

  function spawnBot(room, meta, time) {
    const position = spawn(room.roundId,room.roomId);
    const bot = {
      id:meta.id, roundId:room.roundId, roomId:room.roomId,
      name:BOT_NAMES[meta.index],
      isBot:true,
      x:position.x, y:position.y, vx:0, vy:0,
      energy:Math.floor(rand(2,7)),
      shieldUntil:time + 4000,
      boostUntil:0, jumpUntil:0,
      inWater:false, lastWaterDamageAt:0,
      skin:BOT_SKINS[meta.index],
      fightingWith:null, fightId:null, defeated:false
    };
    players.set(meta.id,bot);
    meta.respawnAt = null;
    meta.retireAt = null;
    meta.nextDecision = time + rand(400,2200);
    meta.mode = 'pause';
    meta.target = null;
    meta.speed = rand(110,157);
    // Roam and collect modest energy; rare high-energy PvP wins will trigger
    // a delayed leave/rejoin instead of letting bots dominate indefinitely.
    meta.energyCap = Math.floor(rand(35,85));
    meta.pauseUntil = time + rand(300,1200);
    meta.targetId = null;
    meta.escapeSide = random()<0.5?-1:1;
    meta.avoidSide = random()<0.5?-1:1;
    meta.nextSkillAt = time + rand(7500,13500);
    return bot;
  }

  function createRoom(player,time) {
    const key = keyOf(player);
    if (rooms.has(key)) return rooms.get(key);
    const room = {key,roundId:player.roundId,roomId:player.roomId,slots:[]};
    rooms.set(key,room);
    for (let i=0;i<BOT_COUNT;i++) {
      const meta = {id:'echo-bot:'+key+':'+i,index:i,respawnAt:null};
      room.slots.push(meta);
      spawnBot(room,meta,time);
    }
    return room;
  }

  function ensureForRoom(player) {
    if (!player || player.isBot || player.defeated) return;
    if (!rooms.has(keyOf(player))) {
      createRoom(player,now());
      broadcastPlayers(player);
    }
  }

  function removeRoom(room) {
    for (const meta of room.slots) players.delete(meta.id);
    rooms.delete(room.key);
  }

  function removeIfEmpty(roundId,roomId) {
    const room = rooms.get(String(roundId)+':'+String(roomId));
    if (!room) return;
    const hasHuman = [...players.values()].some(p=>!p.isBot && !p.defeated && inRoom(p,room));
    if (!hasHuman) removeRoom(room);
  }

  function reset() {
    for (const room of rooms.values()) for (const meta of room.slots) players.delete(meta.id);
    rooms.clear();
    lastTick = now();
  }

  function nearby(room,bot,maximum) {
    return [...players.values()]
      .filter(p=>p.id!==bot.id && !p.defeated && !p.fightingWith && inRoom(p,room))
      .map(p=>({player:p,distance:Math.hypot(p.x-bot.x,p.y-bot.y)}))
      .filter(candidate=>candidate.distance<maximum)
      .sort((a,b)=>a.distance-b.distance);
  }

  function waypoint(bot,range) {
    for(let i=0;i<12;i++){
      const global = random()<0.22;
      const angle=rand(-Math.PI,Math.PI);
      const distance=rand(range*0.4,range);
      const candidate={
        x:capPosition(global ? rand(-halfSize,halfSize) : bot.x+Math.cos(angle)*distance),
        y:capPosition(global ? rand(-halfSize,halfSize) : bot.y+Math.sin(angle)*distance)
      };
      if(safePoint(candidate))return candidate;
    }
    return {x:bot.x,y:bot.y};
  }

  function choosePlan(room,meta,bot,time) {
    // Wandering is deliberate, with occasional pauses, not random teleports.
    meta.targetId=null;
    if(random()<0.26){
      meta.mode='pause';
      meta.target=null;
      meta.pauseUntil=time+rand(800,3200);
      meta.nextDecision=meta.pauseUntil;
      return;
    }
    if(bot.energy<meta.energyCap && random()<0.18){
      let best=null,nearest=380;
      for(const point of getFood(room.roundId,room.roomId).values()){
        if(!point.active)continue;
        const distance=Math.hypot(point.x-bot.x,point.y-bot.y);
        if(distance<nearest){best=point;nearest=distance;}
      }
      if(best){
        meta.mode='food';
        meta.target={x:best.x,y:best.y};
        meta.nextDecision=time+rand(1600,3600);
        return;
      }
    }
    meta.mode='wander';
    meta.target=waypoint(bot,rand(350,1450));
    meta.nextDecision=time+rand(4300,10000);
  }

  function tactic(room,meta,bot,time) {
    const options=nearby(room,bot,920)
      .filter(({player})=>Number(player.energy)!==Number(bot.energy));
    const current=options.find(({player})=>player.id===meta.targetId);
    // A much stronger enemy at contact range is always an immediate danger.
    const emergency=options.find(({player,distance})=>
      distance<300 && player.energy>bot.energy);
    // Prioritize nearby real players, even when the bots are playing together.
    const human=options.find(({player,distance})=>!player.isBot && distance<760);
    const chosen=emergency||human||
      (current && current.distance<850?current:null)||
      options.find(({distance})=>distance<610);
    if(!chosen)return null;
    const mode=chosen.player.energy<bot.energy?'chase':'flee';
    if(meta.mode!==mode || meta.targetId!==chosen.player.id){
      meta.mode=mode;
      meta.targetId=chosen.player.id;
      meta.escapeSide=random()<0.5?-1:1;
      meta.nextDecision=time+rand(1700,3100);
    }
    return chosen;
  }

  function maybeUseSkill(meta,bot,time,distance) {
    if(time<meta.nextSkillAt || distance<115 || distance>670)return;
    // Skill decision is infrequent even if the ability is available.
    if(random()<0.38){
      if(random()<0.48)bot.jumpUntil=time+SKILL_JUMP_MS;
      else bot.boostUntil=time+700;
      meta.nextSkillAt=time+rand(12000,21000);
    }else meta.nextSkillAt=time+rand(2200,4800);
  }

  function slowDown(bot,dt) {
    const previous=Math.hypot(bot.vx,bot.vy);
    const damp=Math.exp(-9*dt);
    bot.vx*=damp; bot.vy*=damp;
    if(Math.hypot(bot.vx,bot.vy)<1){bot.vx=0;bot.vy=0;}
    return previous>0.5;
  }

  function moveToward(meta,bot,target,time,dt) {
    const dx=target.x-bot.x,dy=target.y-bot.y;
    const distance=Math.hypot(dx,dy);
    if(distance<32){
      if(meta.mode!=='chase' && meta.mode!=='flee')meta.nextDecision=0;
      return slowDown(bot,dt);
    }
    const powered=time<bot.jumpUntil?265:time<bot.boostUntil?240:meta.speed;
    // Reduced speed when large, matching the shape of the player energy curve.
    const speed=powered*(1-Math.min(0.2,bot.energy/500*0.2));
    const direction=Math.atan2(dy,dx);
    const side=meta.avoidSide;
    // Stable left/right preference stops the bot from alternating around
    // a tree on every tick. Probe *ahead* before committing to a heading.
    const angles=[0,side*.42,side*.85,side*1.32,-side*.42,-side*.85,-side*1.32,Math.PI];
    let chosen=null;
    for(const offset of angles){
      const heading=direction+offset;
      const ax=Math.cos(heading),ay=Math.sin(heading);
      const look=Math.min(82,Math.max(48,speed*.38),distance);
      if(!safePoint({x:bot.x+ax*look,y:bot.y+ay*look}))continue;
      if(!safePoint({x:bot.x+ax*speed*dt,y:bot.y+ay*speed*dt}))continue;
      chosen={x:ax,y:ay};
      break;
    }
    if(!chosen){
      meta.avoidSide*=-1;
      if(meta.mode==='wander'||meta.mode==='food')meta.nextDecision=0;
      return slowDown(bot,dt);
    }
    // Velocity is continuous; movement never rotates the *existing* velocity
    // by 45 degrees each tick (the former source of zigzagging).
    const blend=1-Math.exp(-5.5*dt);
    const nextVx=bot.vx+(chosen.x*speed-bot.vx)*blend;
    const nextVy=bot.vy+(chosen.y*speed-bot.vy)*blend;
    const next={x:bot.x+nextVx*dt,y:bot.y+nextVy*dt};
    if(!safePoint(next)){
      // Approach obstacles slowly instead of snapping to another direction.
      meta.avoidSide*=-1;
      return slowDown(bot,dt);
    }
    bot.x=next.x;bot.y=next.y;
    bot.vx=nextVx;bot.vy=nextVy;
    return true;
  }

  function step(room,meta,bot,time,dt) {
    if(bot.fightingWith||bot.defeated){
      return slowDown(bot,dt);
    }
    const nearbyOpponent=tactic(room,meta,bot,time);
    let target;
    if(nearbyOpponent){
      const opponent=nearbyOpponent.player;
      const dist=nearbyOpponent.distance;
      maybeUseSkill(meta,bot,time,dist);
      if(meta.mode==='flee'){
        const dx=bot.x-opponent.x,dy=bot.y-opponent.y;
        const length=Math.max(1,Math.hypot(dx,dy));
        const x=dx/length,y=dy/length;
        const side=meta.escapeSide;
        // A small lateral component gives variety without a random zigzag.
        target={x:capPosition(bot.x+x*530-y*side*95),
          y:capPosition(bot.y+y*530+x*side*95)};
      }else target={x:opponent.x,y:opponent.y};
    }else{
      if(meta.mode==='chase'||meta.mode==='flee'||
         time>=meta.nextDecision ||
         (meta.mode==='pause'&&time>=meta.pauseUntil)){
        choosePlan(room,meta,bot,time);
      }
      if(meta.mode==='pause')return slowDown(bot,dt);
      target=meta.target;
    }
    if(!target)return slowDown(bot,dt);
    const moved=moveToward(meta,bot,target,time,dt);
    if(!moved)return false;
    if(bot.energy<meta.energyCap){
      const collected=collectFood(bot);
      if(collected>0){
        bot.energy=Math.min(meta.energyCap,bot.energy+collected);
        return 'food';
      }
    }
    return true;
  }

  function tick() {
    const time=now();
    const dt=Math.min(0.35,Math.max(0.01,(time-lastTick)/1000));
    lastTick=time;
    const humans=new Map();
    for(const player of players.values()){
      if(player.isBot || player.defeated)continue;
      if(!humans.has(keyOf(player)))humans.set(keyOf(player),player);
    }
    for(const room of [...rooms.values()])if(!humans.has(room.key))removeRoom(room);
    for(const player of humans.values())if(!rooms.has(keyOf(player)))createRoom(player,time);
    for(const room of rooms.values()){
      let changed=false,foodChanged=false;
      for(const meta of room.slots){
        let bot=players.get(meta.id);
        if(!bot){
          // A bot defeated in normal PvP leaves the player map. Its slot
          // returns after a short break, without a socket, account or ad.
          if(meta.respawnAt===null)meta.respawnAt=time+rand(NORMAL_RESPAWN_MIN_MS,NORMAL_RESPAWN_MAX_MS);
          if(time>=meta.respawnAt){bot=spawnBot(room,meta,time);changed=true;}
          else continue;
        }
        if(bot.energy>ENERGY_REJOIN_THRESHOLD && meta.retireAt===null) {
          meta.retireAt=time+rand(EXHAUSTED_EXIT_MIN_MS,EXHAUSTED_EXIT_MAX_MS);
        }
        // Never disappear in the middle of the authoritative PvP resolution.
        if(meta.retireAt!==null && time>=meta.retireAt && !bot.fightingWith){
          players.delete(bot.id);
          meta.retireAt=null;
          meta.respawnAt=time+rand(NORMAL_RESPAWN_MIN_MS,NORMAL_RESPAWN_MAX_MS);
          changed=true;
          continue;
        }
        const action=step(room,meta,bot,time,dt);
        if(action)changed=true;
        if(action==='food')foodChanged=true;
        if(!bot.fightingWith)checkForFights(bot);
      }
      // At most four grouped state broadcasts per second, not per bot.
      if(changed){
        const anchor=humans.get(room.key);
        if(anchor)broadcastPlayers(anchor);
      }
      if(foodChanged){
        const anchor=humans.get(room.key);
        if(anchor)broadcastFood(anchor);
      }
    }
  }

  return {ensureForRoom,removeIfEmpty,reset,tick,roomCount:()=>rooms.size};
}
module.exports={createAiBots,BOT_COUNT,TICK_MS};
