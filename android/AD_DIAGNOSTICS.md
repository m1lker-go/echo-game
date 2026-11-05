# ECHO Android — VK Ads diagnostic APK

Use the **diagnostic** build type to investigate live myTarget (VK Ads) loading
without exposing advertising identifiers or tokens in public release logs.
The normal **release** type keeps SDK verbose diagnostics disabled.

## Build locally (do not upload diagnostic builds to RuStore)

1. In your clean local checkout, switch to `apk`, then `git pull origin apk`.
2. In Android Studio, run **Sync Project with Gradle Files**.
3. Choose **Build > Generate Signed Bundle / APK > APK** and the existing RuStore signing key.
   Select the **diagnostic** build type (NOT release). Never create a new signing key.
4. Install the diagnostic APK reported by Android Studio. Do not reinstall an older
   `app/release/app-release.apk` accidentally.
5. Verify that it is **versionCode 24**, **versionName 1.0.5-diag**.

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell dumpsys package ru.echogame.arena | Select-String "versionCode=|versionName="
```

## Capture targeted Logcat output

Clear old log lines, open ECHO's native home menu while signed in to an account without "Без рекламы", visit Quests, try a rewarded ad, then enter/replay
a battle for interstitials. Wait at least **45 seconds** after `onNoAd`;
the SDK is deliberately not hammered with repeated requests.

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -c
```

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -d -v time | Select-String "EchoBattleAd|EchoRewardedAds|EchoAdDiag"
```

In `EchoAdDiag`, look for **Diagnostic APK version=1.0.5-diag** and the
corresponding request / load / display / reward / dismiss stages. The SDK
may not expose every error code; `onNoAd` still records its message.

### Key events

- `Preloading interstitial slot=2097075` — requesting a future ad.
- `Interstitial preloaded` — a ready ad is cached, but not displayed yet.
- `Showing preloaded interstitial` — the player reached a battle-entry ad break.
- `Interstitial unavailable` — network had no fill; cooldown before a new request.
- `Interstitial entry resolved: cooldown` — battle proceeds instead of trapping a player.
- `Interstitial skipped: account is ad-free` — paid entitlement was verified.
- `Interstitial skipped: entitlement status unavailable` — status could not be verified;
  ads are skipped to avoid accidentally showing them to a paid player.
- `Preloading rewarded slot=2096987` — warming the reward placement from the native home menu, after account and ad-free verification.
- `Rewarded preloaded` — cached, ready for the player's request.
- `Rewarded displayed` — ad opened, but reward is **not** confirmed.
- `Rewarded earned` / `onReward` — **only** this confirms a rewarded viewing.
- `Rewarded dismissed ... reward=false` — the creative closed without confirmation;
  the app must not grant coins based on dismissal.
- `Rewarded preload retry in 45000ms` — no-fill cooldown.

Rewarded placement 2096987 uses one shared process-wide cache between the home menu and Quests; switching screens does not reset its no-fill cooldown or destroy a ready ad. Only the Quests WebView can request a rewarded display. Logging out, deleting the account, or a verified ad-free entitlement clears the shared cache. Verification failure does not trigger background preload.

Cached ads expire after **30 minutes**. Each displayed ad is consumed once,
and the next load starts after closing. A no-fill response retries after
**45 seconds**, not once per tap. If an ad is still loading, interstitial
entry waits at most **6.5 seconds**; a rewarded on-demand request waits at
most **9 seconds**. Late loads remain cached for a later chance to show.
These changes cannot guarantee fill from the ad network.

## Privacy and release safety

- Never publish `diagnostic` to RuStore; publish a verified normal
  `release` only after on-device testing and a proper version bump.
- Never post unfiltered Logcat dumps. Filter by ECHO tags and redact IDs.
- Do not convert an interstitial or an incomplete creative into a rewarded
  completion. The server issues game rewards only after the proper flow.
- The promotional Cat Fighting fallback and third-party ad mediation
  are **not part of this phase**.
