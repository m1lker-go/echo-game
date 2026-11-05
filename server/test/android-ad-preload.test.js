'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const interstitial=read('android/app/src/main/java/ru/echo/game/EchoBattleInterstitial.kt');
const rewarded=read('android/app/src/main/java/ru/echo/game/EchoRewardedAds.kt');
const activity=read('android/app/src/main/java/ru/echo/game/EchoWebActivity.kt');

test('APK retains separate VK Ads slots and does not treat interstitial as rewarded',()=>{
 assert.match(interstitial,/const val SLOT_ID = 2097075/);
 assert.match(rewarded,/const val PLACEMENT_ID = 2096987/);
 assert.match(interstitial,/InterstitialAd\(SLOT_ID, activity\)/);
 assert.match(rewarded,/RewardedAd\(PLACEMENT_ID, activity\)/);
 assert.doesNotMatch(interstitial,/RewardedAd\(/);
 assert.doesNotMatch(rewarded,/InterstitialAd\(/);
});

test('APK preloads and holds one ready ad per format, bounded by cache lifetime',()=>{
 for(const source of [interstitial,rewarded]){
  assert.match(source,/private var cached:/);
  assert.match(source,/private var loading:/);
  assert.match(source,/private var showing:/);
  assert.match(source,/CACHE_TTL_MS = 30 \* 60 \* 1000L/);
  assert.match(source,/SystemClock\.elapsedRealtime\(\) - cachedAt/);
  assert.match(source,/onLoad\(/);
  assert.match(source,/if \(pendingEntry != null\) tryShowCached\(\)|if \(requestId != null\) showCached\(\)/);
  assert.match(source,/\.load\(\)/);
 }
 assert.match(activity,/rewardedAds\?\.preload\(\)/);
 assert.match(interstitial,/if \(!shouldShow\(token\)\)/);
});

test('no-fill and show errors use cooldown; no rapid retry loop',()=>{
 for(const source of [interstitial,rewarded]){
  assert.match(source,/const val RETRY_DELAY_MS = 45000L/);
  assert.match(source,/nextLoadAt = SystemClock\.elapsedRealtime\(\) \+ RETRY_DELAY_MS/);
  assert.match(source,/handler\.postDelayed\(task, delay\)/);
  assert.match(source,/scheduleFailureRetry\(\)/);
  assert.match(source,/override fun onNoAd\(/);
 }
 assert.match(interstitial,/const val ENTRY_WAIT_MS = 6500L/);
 assert.match(rewarded,/const val REQUEST_WAIT_MS = 9000L/);
});

test('paid accounts remain protected and rewarded quests require actual onReward',()=>{
 assert.match(interstitial,/EchoAdFreeAccess\.check\(activity, token\)/);
 assert.match(interstitial,/if \(paid != false\)/);
 assert.match(activity,/paid == false/);
 assert.match(rewarded,/override fun onReward\(/);
 assert.match(rewarded,/dispatch\(id, true\)/);
 assert.match(rewarded,/override fun onDismiss\(/);
 assert.match(rewarded,/LATE_REWARD_GRACE_MS = 700L/);
 assert.match(rewarded,/if \(!rewardDelivered\) dispatch\(pending, false\)/);
 assert.doesNotMatch(rewarded,/onDismiss[\s\S]{0,100}dispatch\([^\n]*true/);
});

test('ad requests and callbacks cannot survive Activity teardown',()=>{
 for(const source of [interstitial,rewarded]){
  assert.match(source,/private var destroyed = false/);
  assert.match(source,/fun destroy\(\) \{/);
  assert.match(source,/retryTask\?\.let \{ handler\.removeCallbacks\(it\) \}/);
  assert.match(source,/cached\?\.let \{ runCatching \{ it\.dismiss\(\) \} \}/);
 }
});
