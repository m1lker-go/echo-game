const test=require('node:test');const assert=require('node:assert/strict');
const {rewardForPlace,rankParticipants}=require('../round-rewards');
test('exact agreed Echo Coin awards',()=>{
 const rewards=[[1,25],[2,21],[3,18],[4,16],[10,16],[11,12],[20,12],[21,10],[30,10],[31,8],[40,8],[41,5],[50,5],[51,0],[150,0]];
 for(const [place,reward] of rewards)assert.equal(rewardForPlace(place),reward);
});
test('participants ranked by score then earliest reach time',()=>{
 const rows=[{profile_id:'a',score:20,reached_at:200},{profile_id:'b',score:20,reached_at:100},{profile_id:'c',score:5,reached_at:1}];
 assert.deepEqual(rankParticipants(rows).map(x=>x.profile_id),['b','a','c']);
});
test('no phantom participants: only actual participants are rewarded',()=>{
 const rows=Array.from({length:10},(_,i)=>({profile_id:String(i),score:100-i,reached_at:i}));
 const ranked=rankParticipants(rows);
 assert.equal(ranked.length,10);
 assert.equal(ranked.filter(x=>x.coins>0).length,10);
});
