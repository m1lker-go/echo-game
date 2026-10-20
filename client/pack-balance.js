// ECHO pack balance. Display rolls are previews until server-side purchases,
// inventory updates and rewarded pack opening have been implemented.
import { CHARACTER_RARITY } from './character-rarity.js';

export const HERO_FRAGMENTS_REQUIRED = Object.freeze({
  common:25, uncommon:30, rare:40, epic:50, legendary:60,
});
export const MAX_HEROES_PER_RARITY = Object.freeze({
  common:4, uncommon:3, rare:3, epic:2, legendary:1,
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
  // Roll each of the five rarity slots using the pack probabilities.
  // Full rarity groups are excluded so a pack never exceeds its hero limits.
  const available=[...candidates],result=[];
  const selectedCounts={common:0,uncommon:0,rare:0,epic:0,legendary:0};
  for(let i=0;i<rule.differentHeroes;i++){
    const eligibleRarities=Object.keys(rule.weights).filter(rarity=>
      rule.weights[rarity]>0 &&
      selectedCounts[rarity]<MAX_HEROES_PER_RARITY[rarity] &&
      available.some(model=>CHARACTER_RARITY[model]===rarity)
    );
    const rarity=weightedPick(eligibleRarities,key=>rule.weights[key],random);
    const eligibleModels=available.filter(model=>CHARACTER_RARITY[model]===rarity);
    const model=eligibleModels[Math.min(eligibleModels.length-1,Math.floor(random()*eligibleModels.length))];
    result.push({model,rarity,count:1});
    selectedCounts[rarity]++;
    available.splice(available.indexOf(model),1);
  }
  // Remaining fragments are assigned to those same five heroes.
  for(let i=rule.differentHeroes;i<rule.cards;i++){
    const target=weightedPick(result,x=>rule.weights[x.rarity],random);
    target.count++;
  }
  return result;
}
