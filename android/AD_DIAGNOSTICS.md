# ECHO Android — VK Ads diagnostic APK

A separate Android **diagnostic** build variant enables extended ad logs,
while ordinary **release** and **debug** variants keep them disabled.
No local `gradle.properties` edits are required.

## Build and install

1. Update the local `apk` branch without discarding local commits:

   ```powershell
   git fetch origin
   git merge --no-ff origin/apk -m "Merge VK Ads diagnostic build type"
   ```

2. In Android Studio use **File → Sync Project with Gradle Files**.
3. Use **Build → Generate Signed App Bundle or APK → APK**. Select the
   same RuStore signing key and choose build type **diagnostic** rather than
   **release**. No key/passwords should be committed.
4. Install the new signed APK over the old one, using the exact file path
   reported by Android Studio. The APK may be placed in
   `android/app/diagnostic/` or the selected output directory;
   do **not** reinstall the older `app/release/app-release.apk` by mistake.
5. Verify that the installed app is **versionCode 23** and versionName
   **1.0.4-diag**:

   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell dumpsys package ru.echogame.arena | Select-String "versionCode=|versionName="
   ```

Build type `diagnostic` inherits all relevant `release` settings,
including the configured release signing when available, and uses the same
Android application ID (`ru.echogame.arena`). This avoids uninstalling
the RuStore-signed game.

## Capture logs

Clear older logs, fully close and reopen ECHO, request one rewarded ad,
and optionally start an ad-eligible battle:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -c
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -d -v time |
  Select-String -Pattern "EchoAdDiag|EchoRewardedAds|EchoBattleAd|myTarget|MyTarget|my.target"
```

Check that the logs contain `Diagnostic APK version=1.0.4-diag`.
If SDK debug mode was not enabled, look for
`Could not enable myTarget SDK verbose logging`; structured request
traces should still work.

`EchoAdDiag` records a local request number, ad format, slot ID,
callback stage, elapsed time, SDK version, and any exposed SDK error code.
The diagnostic build does not switch the account to test advertising and
does not change the live advertising slot IDs.

## Important

- **Never publish the diagnostic APK to RuStore.** Publish only the
  normal `release` variant, which automatically disables detailed logs.
- Never share full, unfiltered Logcat dumps: SDK diagnostic output may
  contain device metadata or unique identifiers. Redact before sharing.
- No changes to local `android/gradle.properties` are required.
