// ECHO interstitial at natural navigation into battle (VK Mini Apps).
// TEMPORARY AD TEST: request on every battle entry starting with #3 for all users.
// Standalone Android uses the same schedule but its native myTarget SDK.
// Block 2097075 belongs to Android; VK Bridge uses ad_format only.
const STORAGE_PREFIX='echo.battleEntries.v1.';
const VK_AD_FORMAT='interstitial';
const AD_TIMEOUT_MS=6000;
const AD_SHOW_TIMEOUT_MS=15000;
const TEST_FIRST_AD_ENTRY=3;
let busy=false;
function moscowDay(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(now).map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
function identityKey(token){
 if(!token)return 'guest';
 // A local non-cryptographic fingerprint, never the bearer token itself.
 let hash=2166136261;
 for(let i=0;i<token.length;i++)hash=Math.imul(hash^token.charCodeAt(i),16777619)>>>0;
 return 'account-'+hash.toString(36);
}
function scheduleBattleEntry({storage=localStorage,token=null,date=moscowDay()}={}){
 const registered=!!token;
 const key=STORAGE_PREFIX+identityKey(token);
 let state={date,count:0};
 try{
  const raw=JSON.parse(storage.getItem(key)||'null');
  if(raw&&raw.date===date&&Number.isInteger(raw.count)&&raw.count>=0&&raw.count<100000)
   state=raw;
 }catch(error){console.warn('[ECHO interstitial] read counter failed',error)}
 state={date,count:state.count+1};
 try{storage.setItem(key,JSON.stringify(state));}catch(error){
  console.warn('[ECHO interstitial] store counter failed',error);
 }
 const first=TEST_FIRST_AD_ENTRY;
 return {count:state.count,registered,showAd:state.count>=first,date};
}
function withAdTimeout(promise, ms, stage){
 let timer;
 return Promise.race([
  Promise.resolve(promise),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(stage+' timed out')),ms);})
 ]).finally(()=>clearTimeout(timer));
}
function diagnostic(message){
 console.info('[ECHO interstitial] '+message);
 // Explicitly visible feedback for temporary testing on VK phones.
 window.ECHOToast?.show(message,2400);
}
async function showVKInterstitial(){
 if(window.isVKMiniApp!==true){
  console.info('[ECHO interstitial] browser has no VK Bridge ad adapter');
  return false;
 }
 try{
  const bridge=await withAdTimeout(
   window.ECHOVKBridgeReady||window.vkBridge,AD_TIMEOUT_MS,'VK Bridge');
  if(!bridge?.send){
   diagnostic('VK Bridge недоступен — бой запускается без рекламы');
   return false;
  }
  const available=await withAdTimeout(
   bridge.send('VKWebAppCheckNativeAds',{ad_format:VK_AD_FORMAT}),
   AD_TIMEOUT_MS,'VK ad check');
  if(available?.result!==true){
   diagnostic('VK: полноэкранная реклама пока недоступна');
   return false;
  }
  const shown=await withAdTimeout(
   bridge.send('VKWebAppShowNativeAds',{ad_format:VK_AD_FORMAT}),
   AD_SHOW_TIMEOUT_MS,'VK ad display');
  if(shown?.result!==true){
   diagnostic('VK: показ рекламы не подтвердился');
   return false;
  }
  console.info('[ECHO interstitial] VK interstitial shown successfully');
  return true;
 }catch(error){
  console.info('[ECHO interstitial] skipped:',error?.message||error);
  diagnostic('VK: не удалось показать рекламу');
  return false;
 }
}
export async function showAdBeforeBattle(){
 // Both Start Game and Replay call this; native APK uses its own SDK.
 if(busy)return false;
 busy=true;
 try{
  const counter=scheduleBattleEntry({token:localStorage.getItem('echo.authToken')});
  console.info('[ECHO interstitial] entry #'+counter.count+', request ad: '+counter.showAd);
  if(!counter.showAd)return false;
  return await showVKInterstitial();
 }finally{busy=false;}
}
export const battleAdSchedule={moscowDay,identityKey,scheduleBattleEntry};
