// ECHO rewarded video adapter. Cat Fighting uses the same two VK Bridge
// methods, with its own placement. ECHO placement: 2096987.
//
// The APK is a standalone Android WebView, NOT a VK Mini App. Its rewarded
// video needs a separate native VK Ads Android SDK implementation; this
// adapter intentionally never simulates "watched" outside VK.
export const ECHO_REWARDED_PLACEMENT_ID=2096987;

export async function watchEchoRewardedVideo(onReady) {
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
