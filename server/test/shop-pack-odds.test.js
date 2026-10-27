'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../../client');
const source=fs.readFileSync(path.join(root,'shop-pack-odds.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'shop.css'),'utf8');
const balance=fs.readFileSync(path.join(root,'pack-balance.js'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');

test('Each shop pack has a separate top-right question button without changing purchase buttons',()=>{
 for(const type of ['coin','premium']){
  assert.match(html,new RegExp('data-echo-pack-info="'+type+'"'));
  assert.match(html,new RegExp('data-echo-preview-pack="'+type+'"'));
 }
 assert.match(html,/shop-pack-odds\.js\?v=echo-pack-odds-1/);
 assert.match(html,/shop\.css\?v=echo-pack-odds-1/);
 assert.match(css,/#main-menu \.echo-shop-pack \.echo-shop-pack-info\{/);
 assert.match(css,/position:absolute!important;z-index:8;top:/);
 assert.match(css,/background:#000;color:#fff/);
 assert.match(css,/border:1\.5px solid #fff/);
});

test('Both information dialogs use the standard ECHO modal with five aligned rarity rows',()=>{
 assert.match(source,/import \{ PACK_RULES \} from '\.\/pack-balance\.js'/);
 assert.match(source,/window\.ECHOModal\.open\(/);
 assert.match(source,/button\.dataset\.echoPackInfo/);
 assert.match(source,/\['common','uncommon','rare','epic','legendary'\]/);
 assert.match(source,/rarityHeading\.scope='col'/);
 assert.match(source,/chanceHeading\.scope='col'/);
 assert.match(css,/th:last-child,[\s\S]*?td:last-child\{text-align:center/);
 assert.match(css,/td:first-child\{text-align:left;padding-left:16px/);
 for(const language of ['ru','en']){
  const dict=JSON.parse(fs.readFileSync(path.join(root,'locales',language+'.json'),'utf8')).menu;
  for(const key of ['pack_odds_title_coin','pack_odds_title_premium','pack_odds_summary_coin',
   'pack_odds_summary_premium','pack_odds_rarity','pack_odds_chance','pack_odds_note',
   'pack_odds_common','pack_odds_uncommon','pack_odds_rare','pack_odds_epic','pack_odds_legendary']){
   assert.ok(dict[key],language+' translation missing '+key);
  }
 }
});

test('Displayed pack base odds reflect the real server rolls, including zero common premium cards',()=>{
 const expected={
  coin:{common:60,uncommon:27,rare:10,epic:2.5,legendary:0.5},
  premium:{common:0,uncommon:28,rare:39,epic:26,legendary:7}
 };
 for(const [type,weights] of Object.entries(expected)){
  const weightLiteral=Object.entries(weights).map(([name,n])=>name+':'+String(n).replace(/^0\./,'.')).join(',');
  // Check both independent probability sources; the UI reads PACK_RULES directly.
  assert.ok(balance.replace(/\s/g,'').includes('weights:Object.freeze({'+weightLiteral+'})'),
   'pack-balance rarity values differ for '+type);
  assert.ok(server.replace(/\s/g,'').includes(type+':{'+weightLiteral+'}'),
   'secure server rarity values differ for '+type);
  assert.equal(Object.values(weights).reduce((a,b)=>a+b,0),100);
 }
 assert.match(balance,/cards:5, differentHeroes:5/);
 assert.match(balance,/cards:15, differentHeroes:5/);
 assert.match(source,/Number\(rule\.weights\[rarity\]\)\/total\*100/);
});
