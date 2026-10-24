// ECHO rewarded video adapter. Cat Fighting uses the same two VK Bridge
// methods, with its own placement. ECHO placement: 2096987.
//
// The APK is a standalone Android WebView, NOT a VK Mini App. Its rewarded
// video needs a separate native VK Ads Android SDK implementation; this
// adapter intentionally never simulates "watched" outside VK.
export const ECHO_REWARDED_PLACEMENT_ID=2096987;

export async function watchEchoRewardedVideo(onReady) {
 // The standalone ECHO APK uses the native VK Ads / myTarget SDK.
 // It dispatches the result only from RewardedAd.onReward, never on close.
 if(window.EchoAndroidAds?.showRewardedVideo){
  try{
   const attempt=await onReady();
   if(!attempt?.attemptId)return {watched:false,reason:'server'};
   return await new Promise(resolve=>{
    let finished=false;
    let timer;
    const finish=(watched,reason)=>{
     if(finished)return;
     finished=true;
     clearTimeout(timer);
     window.removeEventListener('echo:native-rewarded-result',listener);
     resolve({watched,reason,attemptId:attempt.attemptId});
    };
    const listener=event=>{
     if(event.detail?.attemptId!==attempt.attemptId)return;
     finish(event.detail.watched===true,event.detail.watched?'complete':'unavailable');
    };
    window.addEventListener('echo:native-rewarded-result',listener);
    timer=setTimeout(()=>finish(false,'unavailable'),120000);
    try{window.EchoAndroidAds.showRewardedVideo(attempt.attemptId);}
    catch(e){console.warn('[ECHO native ads]',e);finish(false,'unavailable');}
   });
  }catch(error){
   console.warn('[ECHO native rewarded] could not start',error);
   return {watched:false,reason:'server'};
  }
 }
 if(window.isVKMiniApp!==true)
  return {watched:false,reason:'unsupported'};
 try{
  const bridge=await (window.ECHOVKBridgeReady || Promise.resolve(window.vkBridge));
  if(!bridge?.send)return {watched:false,reason:'unsupported'};
  const params={ad_format:'reward',placement_id:ECHO_REWARDED_PLACEMENT_ID};
  const availability=await bridge.send('VKWebAppCheckNativeAds',params);
  if(availability?.result!==true)return {watched:false,reason:'unavailable'};
  // Create a one-use server attempt BEFORE actually opening the video.
  const attempt=await onReady();
  if(!attempt?.attemptId)return {watched:false,reason:'server'};
  const result=await bridge.send('VKWebAppShowNativeAds',params);
  return {watched:result?.result===true,reason:result?.result===true?'complete':'incomplete',attemptId:attempt.attemptId};
 }catch(error){
  console.warn('[ECHO rewarded video] failed',error?.message||error);
  return {watched:false,reason:'unavailable'};
 }
}
