# ECHO Android — APK branch (0.2.3)

Independent Android Studio project. Main website and server are unchanged.

## Open in Android Studio

1. Switch to the existing `apk` branch and use Git > Pull.
2. Open `android/` as the Android Studio project (not the repository root).
3. Allow Gradle Sync to finish and download SDK components (Google Maven/AAPT2 needs network access).
4. Select `app` and Run on a phone, or Build > Build APK(s).
5. GitHub Actions does **not** build APKs on every push; the workflow is manual-only.

## What's real in this build

- Fullscreen landscape with a native main menu and settings.
- Black ECHO starfield with independently pulsing 46 particles and the original SchuelerSuperXP font.
- All five original background-music MP3 tracks bundled in Android.
- Music volume slider (initially 60%) and sound effects slider (70%) actually work and persist.
- Native UI click sounds, Russian/English switcher, and WebView cache clearing with confirmation.
- Android pauses its native playlist during Arena/other web screens and when the app is backgrounded; the website handles in-game music.
- Original ECHO Arena, Heroes, Shop and Quests run inside WebView so their real GLB previews, pack animation, account-backed collection, purchases and quest actions aren't replaced with fake offline placeholder data.
- Account and code redemption open the existing website's settings/code UI in WebView.

## Still to implement

Native account/session integration and verified server data for native Heroes, Shop and Quests. Those screens intentionally use the live web implementation until native functionality is equivalent. Paid Android purchases still require platform-specific work. VK ID login may require external-browser handling on certain WebView/device combinations. Do not assume a VK Mini App account signs in automatically in Android.

WebView also has its own session storage, but shares origin-based WebView cookies/localStorage between ECHO WebView screens. The game requires internet.

## Safety

- Work only on the `apk` branch. Do not merge into `main` until reviewed.
- Do not change Cat Fighting, its server/database, or any user account credentials.
- Android does not export a JavaScript bridge. Main-frame external HTTP(S) links use the system browser.
- Android music resources are copied from the ECHO client assets without modification.


## Black WebView troubleshooting (Android Studio debug build)

When a WebView screen stays black, press the small **?** at the top-right of the screen in a debug build.
It displays the exact HTML loading state, whether ECHO's JavaScript started, which menu is visible,
the WebView engine version, and the most recent JavaScript error, without exposing tokens.
Take a screenshot of this dialog and send it for diagnosis.

Other error conditions are shown on the screen with **RETRY** and **CHECK SITE IN BROWSER**;
the external browser option is only a diagnostic fallback. Logcat filter: `EchoWebView`.

The navigation back button is intentionally the same black/white outlined control as ECHO web,
positioned at the bottom on menu pages; the Arena uses a top-left close symbol.
The Android settings now use matching left-aligned section labels, language flags,
equally sized action buttons and white-outlined audio sliders.

Do not assume VK ID OAuth works inside Android WebView until verified on the phone.
Its popup/callback flow may require further Android-specific integration.
