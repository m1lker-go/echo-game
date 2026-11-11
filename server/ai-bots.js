'use strict';

// Lightweight server-owned ECHO opponents. They are ordinary participants in
// movement, food and PvP, but have no Socket.IO connection, account or rewards.
const BOT_NAMES = Object.freeze(['Max', 'Tim', 'Bob', 'Alex', 'Leo']);
const BOT_SKINS = Object.freeze([
  'character-male-a.glb', 'character-female-c.glb',
  'character-male-b.glb', 'character-female-e.glb', 'character-male-c.glb'
]);
const BOT_COUNT = BOT_NAMES.length;
const TICK_MS = 250;

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
      name:BOT_NAMES[meta.index] + ' [BOT]',
      isBot:true,
      x:position.x, y:position.y, vx:0, vy:0,
      energy:Math.floor(rand(2,7)),
      shieldUntil:time + 4000,
      inWater:false, lastWaterDamageAt:0,
      skin:BOT_SKINS[meta.index],
      fightingWith:null, fightId:null, defeated:false
    };
    players.set(meta.id,bot);
    meta.respawnAt = null;
    meta.nextDecision = time + rand(400,2200);
    meta.mode = 'pause';
    meta.target = null;
    meta.speed = rand(110,157);
    meta.energyCap = Math.floor(rand(12,22));
    meta.pauseUntil = time + rand(300,1200);
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
    // One in four decisions is a real pause; avoid uniform robotic motion.
    if (random()<0.26) {
      meta.mode='pause'; meta.target=null;
      meta.pauseUntil=time+rand(800,3700);
      meta.nextDecision=meta.pauseUntil;
      return;
    }
    const opponents=nearby(room,bot,730);
    const stronger=opponents.find(({player,distance})=>distance<360 && player.energy>bot.energy+3);
    if (stronger && random()<0.68) {
      const opponent=stronger.player;
      const angle=Math.atan2(bot.y-opponent.y,bot.x-opponent.x)+rand(-0.55,0.55);
      meta.mode='flee';
      meta.target={x:capPosition(bot.x+Math.cos(angle)*rand(240,500)),
        y:capPosition(bot.y+Math.sin(angle)*rand(240,500))};
      meta.nextDecision=time+rand(900,2400);
      return;
    }
    const weaker=opponents.filter(({player,distance})=>distance<650 && bot.energy>player.energy+3 && distance>65);
    if(weaker.length && random()<0.35) {
      meta.mode='chase';
      meta.targetId=weaker[Math.floor(random()*weaker.length)].player.id;
      meta.nextDecision=time+rand(1700,3500);
      return;
    }
    // Food is an occasional objective, never a permanent grind.
    if(bot.energy<meta.energyCap && random()<0.18) {
      let best=null, distance=380;
      for (const point of getFood(room.roundId,room.roomId).values()) {
        if(!point.active)continue;
        const d=Math.hypot(point.x-bot.x,point.y-bot.y);
        if(d<distance){best=point;distance=d;}
      }
      if(best){
        meta.mode='food';
        meta.target={x:best.x,y:best.y};
        meta.nextDecision=time+rand(1500,3600);
        return;
      }
    }
    meta.mode='wander';
    meta.target=waypoint(bot,rand(320,1450));
    meta.nextDecision=time+rand(3800,10000);
  }

  function step(room,meta,bot,time,dt) {
    if(bot.fightingWith || bot.defeated) {
      bot.vx=0;bot.vy=0;return false;
    }
    if(time>=meta.nextDecision || (meta.mode==='pause' && time>=meta.pauseUntil)) {
      choosePlan(room,meta,bot,time);
    }
    if(meta.mode==='pause'){
      const stopped=Math.hypot(bot.vx,bot.vy)>0.1;
      bot.vx=0;bot.vy=0;
      return stopped;
    }
    if(meta.mode==='chase'){
      const target=players.get(meta.targetId);
      if(!target || target.defeated || !inRoom(target,room) || bot.energy<=target.energy+1){
        choosePlan(room,meta,bot,time);
      }else meta.target={x:target.x,y:target.y};
    }
    const target=meta.target;
    if(!target || meta.mode==='pause') {
      const stopped=Math.hypot(bot.vx,bot.vy)>0.1;
      bot.vx=0;bot.vy=0;return stopped;
    }
    const dx=target.x-bot.x,dy=target.y-bot.y;
    const dist=Math.hypot(dx,dy);
    if(dist<34){
      meta.nextDecision=0;
      const stopped=Math.hypot(bot.vx,bot.vy)>0.1;
      bot.vx=0;bot.vy=0;
      return stopped;
    }
    const speed=meta.speed*(bot.energy>15?0.94:1);
    const desiredX=dx/dist*speed,desiredY=dy/dist*speed;
    const blend=Math.min(1,dt*5.5);
    bot.vx+=(desiredX-bot.vx)*blend;
    bot.vy+=(desiredY-bot.vy)*blend;
    let moved=false;
    // Steering alternatives yield natural turns around trees and water.
    const angles=[0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2];
    for (const angle of angles) {
      const vx=bot.vx*Math.cos(angle)-bot.vy*Math.sin(angle);
      const vy=bot.vx*Math.sin(angle)+bot.vy*Math.cos(angle);
      const candidate={x:bot.x+vx*dt,y:bot.y+vy*dt};
      if (!safePoint(candidate)) continue;
      bot.x=candidate.x;bot.y=candidate.y;
      bot.vx=vx;bot.vy=vy;
      moved=true;
      break;
    }
    if(!moved){
      const stopped=Math.hypot(bot.vx,bot.vy)>0.1;
      bot.vx=0;bot.vy=0;
      meta.nextDecision=0; // pick another direction on the next tick
      return stopped;
    }
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
          if(meta.respawnAt===null)meta.respawnAt=time+rand(4500,9500);
          if(time>=meta.respawnAt){bot=spawnBot(room,meta,time);changed=true;}
          else continue;
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
