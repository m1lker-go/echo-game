'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {roomIdentityFor,uniqueParticipants}=require('../player-identity');
const {createRoomManager}=require('../room-manager');
const {finalizeRoom}=require('../round-rewards');
const id='123e4567-e89b-42d3-a456-426614174000';
const identity=(profile,socket)=>roomIdentityFor({verifiedAccountId:id,activityProfileId:profile,socketId:socket});
test('VK Mini Apps and browser share one authenticated ranking identity',()=>{
 const phone=identity('profile-for-phone-123','socket-phone');
 const web=identity('profile-for-browser-123','socket-web');
 assert.equal(phone,web);
 assert.equal(web,'account:'+id);
 assert.notEqual(roomIdentityFor({activityProfileId:'profile-for-phone-123',socketId:'socket-phone'}),
  roomIdentityFor({activityProfileId:'profile-for-browser-123',socketId:'socket-web'}));
});
test('switching devices reuses room; accidental concurrent instances count once',()=>{
 const rooms=createRoomManager({now:()=>900010});
 const who=identity('phone','phone-socket');
 assert.equal(rooms.join(who).roomId,1);
 rooms.markAbsent(who);
 assert.equal(rooms.join(identity('web','web-socket')).roomId,1);
 const players=[{id:'phone',energy:50},{id:'web',energy:45},{id:'guest',energy:10}];
 assert.deepEqual(uniqueParticipants(players,p=>p.id==='guest'?'guest':who),[players[0],players[2]]);
});
test('the same authenticated ECHO account earns only once per round, even from two rooms',async()=>{
 const paid=new Set(), ledger=[],wallet=[];
 const pool={connect:async()=>({release(){},async query(sql,args=[]){
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rowCount:0};
  if(sql.startsWith('INSERT INTO echo_round_finalized'))return {rowCount:1,rows:[{round_id:args[0]}]};
  if(sql.startsWith('SELECT profile_id,player_name,score,reached_at FROM echo_round_scores'))
    return {rows:[{profile_id:'account:'+id,player_name:'ECHO',score:100,reached_at:1}]};
  if(sql.startsWith('SELECT id::text AS id FROM echo_accounts'))return {rows:[{id}]};
  if(sql.startsWith('INSERT INTO echo_round_account_awards')){
    const key=args.join(':');if(paid.has(key))return {rowCount:0};
    paid.add(key);return {rowCount:1,rows:[{account_id:args[1]}]};
  }
  if(sql.startsWith('INSERT INTO echo_coin_ledger')){ledger.push(args);return {rowCount:1}}
  if(sql.startsWith('INSERT INTO echo_wallets')){wallet.push(args);return {rowCount:1}}
  throw Error('Unexpected SQL '+sql.slice(0,95));
 }})};
 const first=await finalizeRoom(pool,900000,1);
 const second=await finalizeRoom(pool,900000,2);
 assert.equal(first[0].coins,25);
 assert.equal(second[0].coins,0);
 assert.deepEqual(ledger.map(row=>row[5]),[25,0]);
 assert.deepEqual(wallet,[[id,25]]);
 assert.equal((await finalizeRoom(pool,1800000,1))[0].coins,25);
 assert.equal(wallet.length,2);
});
