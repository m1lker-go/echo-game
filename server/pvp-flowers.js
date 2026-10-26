'use strict';

// Pure server-owned PvP memorials. A flower is created ONLY by a resolved
// PvP defeat; never from a client packet, random world generation or drowning.
const MAX_FLOWERS_PER_ROOM=100;
const FLOWER_MODEL='flowers-tall.glb';
const MIN_SCALE=0.6;
const MAX_SCALE=0.8;

function stableRandom(key){
  let hash=2166136261;
  for(let i=0;i<key.length;i++){
    hash^=key.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0)/4294967296;
}

function createPvpFlowers(){
  const flowersByRoom=new Map();
  const fightsByRoom=new Map();
  const roomKey=(roundId,roomId)=>'echo:'+roundId+':'+roomId;
  function list(roundId,roomId){
    return (flowersByRoom.get(roomKey(roundId,roomId))||[]).slice();
  }
  function add({roundId,roomId,fightId,x,y}={}){
    if(typeof roundId!=='string'||!roundId||
       !Number.isInteger(roomId)||roomId<1||
       typeof fightId!=='string'||!fightId||
       !Number.isFinite(x)||!Number.isFinite(y))return null;
    const key=roomKey(roundId,roomId);
    const seen=fightsByRoom.get(key)||new Set();
    if(seen.has(fightId))return null;
    const flowers=flowersByRoom.get(key)||[];
    if(flowers.length>=MAX_FLOWERS_PER_ROOM)return null;
    seen.add(fightId);
    fightsByRoom.set(key,seen);
    const salt=roundId+':'+roomId+':'+fightId;
    const flower={
      id:'pvp_flower_'+String(flowers.length+1).padStart(3,'0'),
      model:FLOWER_MODEL,
      x,y,
      scale:MIN_SCALE+(MAX_SCALE-MIN_SCALE)*stableRandom(salt+':size'),
      rotation:Math.PI*2*stableRandom(salt+':rotation')
    };
    flowers.push(flower);
    flowersByRoom.set(key,flowers);
    return {...flower};
  }
  function reset(){
    const rooms=[...flowersByRoom.keys()];
    flowersByRoom.clear();
    fightsByRoom.clear();
    return rooms;
  }
  return {add,list,reset};
}

module.exports={createPvpFlowers,MAX_FLOWERS_PER_ROOM,FLOWER_MODEL,MIN_SCALE,MAX_SCALE};
