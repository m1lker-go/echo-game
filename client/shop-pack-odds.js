// Pack information is based on the same rarity weights used by ECHO pack previews.
// The server has matching PACK_WEIGHTS and enforces the actual rewarded roll.
import { PACK_RULES } from './pack-balance.js';

const rarities=['common','uncommon','rare','epic','legendary'];
const fallback={
  coin:{
    title:'СТАНДАРТНЫЙ ПАК',
    summary:'В паке 5 карт для пяти разных персонажей. Редкость выбирается случайно.'
  },
  premium:{
    title:'ПРЕМИУМ-ПАК',
    summary:'В паке 15 карт (фрагментов) для пяти разных персонажей. Редкость выбирается случайно.'
  }
};
const labels={
 common:'Обычная',uncommon:'Необычная',rare:'Редкая',
 epic:'Эпическая',legendary:'Легендарная'
};
const tr=(key,defaultText)=>window.$t?.('menu:'+key,defaultText)??defaultText;
const add=(parent,tag,cls,text)=>{
 const element=document.createElement(tag);
 if(cls)element.className=cls;
 if(text!==undefined)element.textContent=text;
 parent.appendChild(element);
 return element;
};

function showPackOdds(type){
 const rule=PACK_RULES[type],config=fallback[type];
 if(!rule||!config||!window.ECHOModal)return;
 const content=document.createElement('div');
 content.className='echo-pack-odds';
 add(content,'p','echo-pack-odds-summary',tr('pack_odds_summary_'+type,config.summary));
 const table=add(content,'table','echo-pack-odds-table');
 const thead=add(table,'thead');
 const top=add(thead,'tr');
 const rarityHeading=add(top,'th','',tr('pack_odds_rarity','РЕДКОСТЬ'));
 rarityHeading.scope='col';
 const chanceHeading=add(top,'th','',tr('pack_odds_chance','ШАНС'));
 chanceHeading.scope='col';
 const tbody=add(table,'tbody');
 const total=rarities.reduce((sum,rarity)=>sum+(Number(rule.weights[rarity])||0),0);
 const language=document.documentElement.lang?.startsWith('en')?'en-US':'ru-RU';
 const percent=new Intl.NumberFormat(language,{maximumFractionDigits:2});
 for(const rarity of rarities){
  const row=add(tbody,'tr','is-'+rarity);
  const rarityCell=add(row,'td');
  const entry=add(rarityCell,'span','echo-pack-odds-rarity');
  add(entry,'span','echo-pack-odds-dot').setAttribute('aria-hidden','true');
  add(entry,'span','',tr('pack_odds_'+rarity,labels[rarity]));
  add(row,'td','',percent.format(total>0?Number(rule.weights[rarity])/total*100:0)+'%');
 }
 add(content,'p','echo-pack-odds-note',tr('pack_odds_note',
  'Указаны базовые шансы выбора редкости. При подборе пяти разных персонажей вероятность может изменяться из-за ограничений на редкость.'));
 window.ECHOModal.open({
  title:tr('pack_odds_title_'+type,config.title),
  contentElement:content,
  buttons:[{label:tr('pack_odds_close','ЗАКРЫТЬ'),value:true,variant:'primary'}]
 });
}

for(const button of document.querySelectorAll('[data-echo-pack-info]')){
 button.addEventListener('click',event=>{
  event.stopPropagation();
  showPackOdds(button.dataset.echoPackInfo);
 });
}
