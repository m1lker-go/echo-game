// ECHO interstitial at natural navigation into battle (VK Mini Apps).
// Standalone Android uses the same schedule but its native myTarget SDK.
// Block 2097075 belongs to Android; VK Bridge uses ad_format only.
const STORAGE_PREFIX='echo.battleEntries.v1.';
const VK_AD_FORMAT='interstitial';
const AD_TIMEOUT_MS=6000;
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
 const first=registered?5:3;
 return {count:state.count,registered,showAd:state.count>=first&&state.count%2===1,date};
}
async function showVKInterstitial(timeoutMs=AD_TIMEOUT_MS){
 if(window.isVKMiniApp!==true)return false;
 try{
  const bridge=await Promise.race([
   Promise.resolve(window.ECHOVKBridgeReady||window.vkBridge),
   new Promise((_,reject)=>setTimeout(()=>reject(Error('VK Bridge timeout')),timeoutMs))
  ]);
  if(!bridge?.send)return false;
  // One deadline for ad availability, show and dismissal. In case of no fill
  // or a rejected bridge call, navigation is never blocked.
  const available=await Promise.race([
   bridge.send('VKWebAppCheckNativeAds',{ad_format:VK_AD_FORMAT}),
   new Promise((_,reject)=>setTimeout(()=>reject(Error('VK ad check timeout')),timeoutMs))
  ]);
  if(available?.result!==true)return false;
  await bridge.send('VKWebAppShowNativeAds',{ad_format:VK_AD_FORMAT});
  return true;
 }catch(error){
  console.info('[ECHO interstitial] skipped:',error?.message||error);
  return false;
 }
}
export async function showAdBeforeBattle(){
 // Call only for an actual Start Game / Replay action, never page refreshes.
 if(busy)return false;
 busy=true;
 try{
  const counter=scheduleBattleEntry({token:localStorage.getItem('echo.authToken')});
  if(!counter.showAd)return false;
  return await showVKInterstitial();
 }finally{busy=false;}
}
export const battleAdSchedule={moscowDay,identityKey,scheduleBattleEntry};
