// Automatic exchange offer when the ECHO character collection is opened.
const API='/echo/api/heroes/';
const COIN_ICON='./assets/icons/coin.webp';
const LABELS=[
 ['common','обычных','common'],['uncommon','необычных','uncommon'],
 ['rare','редких','rare'],['epic','эпических','epic'],['legendary','легендарных','legendary']
];
const t=(key,ru,en)=>window.$t?.('menu:'+key,document.documentElement.lang?.startsWith('en')?en:ru)||
 (document.documentElement.lang?.startsWith('en')?en:ru);
const element=(tag,cls,text)=>{
 const el=document.createElement(tag);
 if(cls)el.className=cls;
 if(text!==undefined)el.textContent=text;
 return el;
};
let requestId=0,confirming=false;
const authToken=()=>localStorage.getItem('echo.authToken');
function coinImage(size=26){
 const img=element('img','echo-excess-coin');
 img.src=COIN_ICON;img.alt='ECHO Coin';img.width=size;img.height=size;
 return img;
}
async function offerExcessCards(){
 const id=++requestId;
 const original=authToken();
 if(!original||confirming)return;
 try{
  const response=await fetch(API+'excess',{
   headers:{Authorization:'Bearer '+original},cache:'no-store'
  });
  if(!response.ok)throw new Error('Exchange preview HTTP '+response.status);
  const preview=await response.json();
  if(id!==requestId||original!==authToken()||document.querySelector('#menu-character')?.hidden||
      !Number(preview.totalCards)||confirming)return;
  // Never replace another dialog (for example an account confirmation).
  if(document.body.classList.contains('echo-modal-open'))return;
  const content=element('div','echo-excess-content');
  content.append(element('p','echo-excess-intro',
   t('excess_intro','У Вас накопились лишние карты','You have extra cards')));
  const counts=element('p','echo-excess-counts');
  const values=LABELS.filter(([rarity])=>Number(preview.counts?.[rarity])>0)
   .map(([rarity,ru,en])=>String(preview.counts[rarity])+' '+
     t('excess_rarity_'+rarity,ru,en));
  counts.textContent=values.join(', ');
  content.append(counts);
  const explain=element('p','echo-excess-explain');
  explain.append(element('span','',t('excess_explain','Вы можете обменять карты на','Exchange cards for')));
  explain.append(coinImage());
  content.append(explain);
  const reward=element('div','echo-excess-reward');
  reward.append(element('strong','',t('excess_reward','Награда:','Reward:')+' '+preview.totalCoins),coinImage(34));
  content.append(reward,element('p','echo-excess-question',t('excess_question','Обменять?','Exchange?')));

  confirming=true;
  const modal=window.ECHOModal?.open({
   title:t('excess_title','Лишние карты','Extra cards'),
   contentElement:content,
   buttons:[
    {label:t('excess_later','Не сейчас','Not now'),value:false},
    {label:t('excess_yes','Да','Yes'),value:true,variant:'primary',onClick:async()=>{
      const token=authToken();
      if(!token||token!==original)return false;
      try{
       const exchanged=await fetch(API+'exchange',{
        method:'POST',headers:{Authorization:'Bearer '+token},cache:'no-store'
       });
       if(!exchanged.ok)throw new Error('Exchange HTTP '+exchanged.status);
       const result=await exchanged.json();
       if(result.exchanged&&result.coinsGranted>0){
        const toast=element('span','echo-quest-reward-toast');
        toast.append(element('span','',
         t('excess_received','Получено:','Received:')+' '+result.coinsGranted),coinImage(27));
        window.ECHOToast?.show(toast);
        window.dispatchEvent(new Event('echo:shop-balance-refresh'));
        window.dispatchEvent(new Event('echo:hero-collection-refresh'));
       }else{
        window.ECHOToast?.show(t('excess_none','Лишних карт больше нет','No extra cards remain'));
       }
       return true;
      }catch(error){
       console.warn('[echo heroes] exchange failed',error);
       window.ECHOToast?.show(t('excess_error','Не удалось обменять карты','Could not exchange cards'));
       return false;
      }
    }}
   ]
  });
  if(!modal)confirming=false;
 }catch(error){
  console.warn('[echo heroes] extra card preview unavailable',error);
 }
}
function invalidateOffer(){++requestId;}
export {offerExcessCards,invalidateOffer};
