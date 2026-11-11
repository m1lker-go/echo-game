'use strict';
const {uniqueParticipants}=require('./player-identity');

// Visual-only energy ranking; payouts and round scores remain human-only.
function rankRoomEnergy(players,roundId,roomId,identityOf){
  const energyOf=p=>Math.max(0,Number(p.energy)||0);
  const active=[...players]
    .filter(p=>p && !p.defeated && p.roundId===roundId && p.roomId===roomId)
    .sort((a,b)=>energyOf(b)-energyOf(a)||String(a.id).localeCompare(String(b.id)));
  return uniqueParticipants(active,identityOf).map(p=>({
    name:p.name,energy:energyOf(p),identity:identityOf(p)
  }));
}
module.exports={rankRoomEnergy};
