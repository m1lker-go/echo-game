# ECHO Android: opt-in VK Ads diagnostic logging

This is intended for a **locally installed, signed diagnostic APK only**.
Normal public/release builds keep SDK debug output OFF by default.

## Build

1. On a local checkout of branch `apk`, merge current `origin/apk`.
   Do not reset away local commits or local Gradle/signing settings.
2. Add this line to **local** `android/gradle.properties` (do not commit it):

   ```properties
   ECHO_AD_DIAGNOSTICS=true
   ```

3. Sync Gradle, then generate a **signed release APK with the same keystore
   used for the RuStore build**. Version code is now 23 (1.0.4).
4. Install over the currently signed app:

   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r ".\app\release\app-release.apk"
   ```

5. Verify installation:

   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell dumpsys package ru.echogame.arena | Select-String "versionCode=|versionName="
   ```

## Capture logs

Close and reopen ECHO so `EchoApplication.onCreate` runs with diagnostic
flag enabled; look for `EchoAdDiag: myTarget SDK verbose logging ENABLED`.
If you see `Could not enable myTarget SDK verbose logging`, report that
line as well; the request-level traces still work.

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -c
# Now load a rewarded ad once; optionally enter one battle eligible for interstitial.
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -d -v time |
  Select-String -Pattern "EchoAdDiag|EchoRewardedAds|EchoBattleAd|myTarget|MyTarget|my.target"
```

`EchoAdDiag` traces each request with a local request number, format,
slot ID, stage, elapsed time, SDK version and any exposed error code.
The SDK debug mode may print additional internal messages with different
log tags. If necessary, inspect the surrounding Logcat output privately.

## Safety and cleanup

- Do **not** upload the diagnostic APK to RuStore.
- Do **not** share raw, unrestricted device logs: SDK internals can include
  advertising IDs, URLs, or device metadata. Review/redact before sharing.
- This flag does not activate test advertising or override the live slot IDs.
- **Remove** `ECHO_AD_DIAGNOSTICS=true` from local
  `android/gradle.properties` (or set it to false) before building the
  next public release.
