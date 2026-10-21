'use strict';
function roomIdentityFor({verifiedAccountId,activityProfileId,socketId}){
 return verifiedAccountId?'account:'+String(verifiedAccountId).toLowerCase():(activityProfileId||socketId);
}
function uniqueParticipants(players,identityOf){
 const seen=new Set();
 return players.filter(player=>{
  const id=identityOf(player);
  if(!id||seen.has(id))return false;
  seen.add(id);return true;
 });
}
module.exports={roomIdentityFor,uniqueParticipants};
