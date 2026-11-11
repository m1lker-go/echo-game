'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {rankRoomEnergy}=require('../room-energy-leaderboard');

test('energy tab includes bots with players and sorts by energy',()=>{
  const participants=[
    {id:'player',name:'Human',roundId:'r',roomId:1,energy:12},
    {id:'b1',name:'Max',roundId:'r',roomId:1,energy:45,isBot:true},
    {id:'b2',name:'Leo',roundId:'r',roomId:1,energy:20,isBot:true},
    {id:'out',name:'Other',roundId:'r',roomId:2,energy:900},
    {id:'dead',name:'Dead',roundId:'r',roomId:1,energy:700,defeated:true}
  ];
  const ranked=rankRoomEnergy(participants,'r',1,p=>p.id);
  assert.deepEqual(ranked.map(p=>p.name),['Max','Leo','Human']);
  assert.deepEqual(ranked.map(p=>p.energy),[45,20,12]);
});

test('duplicate real account sessions do not hide distinct bots',()=>{
  const entries=[
    {id:'h1',name:'Human',energy:3,roundId:'r',roomId:1},
    {id:'h2',name:'Human',energy:8,roundId:'r',roomId:1},
    {id:'b1',name:'Tim',energy:7,isBot:true,roundId:'r',roomId:1},
    {id:'b2',name:'Bob',energy:6,isBot:true,roundId:'r',roomId:1}
  ];
  const ranked=rankRoomEnergy(entries,'r',1,p=>p.isBot?p.id:'account:same');
  assert.deepEqual(ranked.map(p=>p.name),['Human','Tim','Bob']);
});

test('bots cannot affect coins, round scores or the displayed online-human count',()=>{
  const code=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
  assert.match(code,/const active = \[\.\.\.players\.values\(\)\]\.filter\(p => !p\.isBot/);
  assert.match(code,/const rankedPlayers=uniqueParticipants\(active,identityOf\)/);
  assert.match(code,/const energyRanked=rankRoomEnergy\(players\.values\(\),roundId,roomId,identityOf\)/);
  assert.match(code,/playersOnline:rankedPlayers\.length/);
  assert.match(code,/roundRewards\.writeTick\(pool,roundId,roomId,earned\)/);
});
