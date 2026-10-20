// ECHO pack balance. Display rolls are previews until server-side purchases,
// inventory updates and rewarded pack opening have been implemented.
import { CHARACTER_RARITY } from './character-rarity.js';

export const HERO_FRAGMENTS_REQUIRED = Object.freeze({
  common:25, uncommon:30, rare:40, epic:50, legendary:60,
});
export const PACK_RULES = Object.freeze({
  coin: Object.freeze({
    cards:5, differentHeroes:5,
    weights:Object.freeze({common:60,uncommon:27,rare:10,epic:2.5,legendary:0.5}),
  }),
  premium: Object.freeze({
    cards:15, differentHeroes:5,
    weights:Object.freeze({common:0,uncommon:28,rare:39,epic:26,legendary:7}),
  }),
});

function weightedPick(items, weightOf, random) {
  const weighted=items.map(item=>({item, weight:Math.max(0,weightOf(item))}));
  const sum=weighted.reduce((s,x)=>s+x.weight,0);
  if(sum<=0)throw new Error('No selectable characters remain');
  let ticket=random()*sum;
  for(const {item,weight} of weighted){ticket-=weight;if(ticket<0)return item;}
  return weighted[weighted.length-1].item;
}

export function rollPack(type, random=Math.random) {
  const rule=PACK_RULES[type];
  if(!rule)throw new Error('Unknown pack type: '+type);
  const candidates=Object.keys(CHARACTER_RARITY).filter(model=>rule.weights[CHARACTER_RARITY[model]]>0);
  if(candidates.length<rule.differentHeroes||rule.cards<rule.differentHeroes)throw new Error('Invalid pack configuration');
  // Choose five distinct hero types, weighted by the rarity of each draw.
  const available=[...candidates],result=[];
  for(let i=0;i<rule.differentHeroes;i++){
    const model=weightedPick(available,m=>rule.weights[CHARACTER_RARITY[m]]/candidates.filter(x=>CHARACTER_RARITY[x]===CHARACTER_RARITY[m]).length,random);
    result.push({model,rarity:CHARACTER_RARITY[model],count:1});
    available.splice(available.indexOf(model),1);
  }
  // Remaining fragments are assigned to those same five heroes.
  for(let i=rule.differentHeroes;i<rule.cards;i++){
    const target=weightedPick(result,x=>rule.weights[x.rarity],random);
    target.count++;
  }
  return result;
}
