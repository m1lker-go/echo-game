# ECHO Android — APK branch (0.3.3)

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
- VK ID account login is native, based on Cat Fighting's Android SDK callback pattern; code redemption uses the website's modal in WebView.

## Still to implement

Native server data integration for fully native Heroes, Shop and Quests. Those screens intentionally use the live web implementation until native functionality is equivalent. Paid Android purchases still require platform-specific work. VK ID requires separate Android client configuration for ECHO app id 54832804 (package, SHA-1 and protected client key). See `VK_ID_AUTH.md`. Do not assume a VK Mini App account signs in automatically in Android.

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

Android Settings now use the **native VK ID SDK** rather than WebView OAuth. The SDK callback is handled by MainActivity, and the resulting ECHO bearer session is persisted privately and synced into the ECHO WebView. The VK developer portal must be configured for this Android package and signing key. See `VK_ID_AUTH.md`.

## WebGL and edge scrolling (0.3.1)

The handset logs show ECHO's JavaScript/GLB/socket startup and the old false
positive `ECHO ready: ARENA`, not proof of a painted WebGL frame. Web content
now runs in an unexported native `EchoWebActivity` with the WebView as a
direct hardware-accelerated window child, rather than embedding it in Compose
via `AndroidView`. Native VK ID login and the same-origin ECHO session
transfer are preserved. The debug `?` control reports DOM, canvas pixel
dimensions, WebGL context and context-loss status if the screen remains black.

The native Home and Settings use a **full-width** vertical scroll container.
Only the visible controls remain constrained by `menu-width.css` dimensions.
Vertical gestures started on the blank left/right side now scroll the page
when its contents overflow the screen.

No production HTML/CSS/server changes were made. Run through Android Studio
and verify rendering on an affected Xiaomi/MIUI phone; this change is a
targeted GPU/view-composition hypothesis and is not yet device-proven.

## Native loading veil and close control (0.3.2)

- The debug-only question mark formerly shown at the top-right is gone.
- The Arena's close X is restored to the top-right. On other web menus,
  the normal bottom Back button remains. In Android Studio debug builds,
  long-press the close/Back button to see WebView diagnostics.
- A **native opaque loading screen** draws 46 independently moving and
  pulsing particles matching ECHO's native home background, centered
  "Загрузка страницы" text and a rotating circular progress indicator.
- The WebView loads the original ECHO web menu *behind* this screen. The
  loading veil is removed only once the requested destination is actually
  visible (arena, shop, character, quests or code modal), plus a short
  frame-compositing grace period. The original web CSS and UI remain intact.
- Readiness checks ignore unrelated older page loads. After an extended
  unsuccessful load, a Retry/Back dialog is shown rather than an infinite
  spinner. Debug diagnostics remain accessible by a long press.
- No website, server, Cat Fighting, or GitHub Actions build changes.


## Unified top-right navigation (0.3.3)

- Source of truth: main/client/fullscreen.css lines describing the fixed
  #game-exit menu Back arrow and Arena Close cross.
- Every opened WebView subpage now uses the same native **top-right square**
  (44dp, or 42dp at <=600dp viewport), dark fill, 70%-white border,
  10dp corner radius. Position is calculated from the original UI scale
  and minimap toolbar horizontal alignment. **No lower Back bar.**
- Arena shows Close (X); Heroes, Shop, Quests and Code use a left-chevron.
  On Pack Opening, the control switches from Back to Close and clicks the
  original pack close action instead of leaving the whole Shop.
- Settings (Compose) now has the same fixed top-right chevron, and the old
  oversized bottom Back button was removed; its content still scrolls
  from blank edges.
- Original web fullscreen toggle and duplicate web navigation buttons
  are hidden **only inside APK WebView**, preserving main and all browser UX.
- In Android Studio debug runs, long-press the native navigation icon for
  the existing diagnostics. Nothing labeled '?' is displayed.
- No modifications were made to main's CSS, production server, VK auth or
  GitHub Action build automation.
