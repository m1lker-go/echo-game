# ECHO Android — APK branch (0.3.6)

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

## Native cache-reset confirmation (0.3.4)

Android Settings -> "Очистить кэш игры" now opens a **native ECHO-styled
confirmation modal**, replacing the basic Material AlertDialog. It recreates
main/client/style.css's .echo-modal-overlay and .echo-modal design:
- translucent dark full-screen overlay with the same 46 moving/twinkling stars
  as the native menu and browser ECHOModal
- centered black panel with 1dp white border, 13dp rounded corners
- responsive title "СБРОС КЭША", original browser prompt, and equal
  NO (dark) / YES (white) buttons
- landscape-safe scrolling, backdrop taps do not accidentally confirm
- YES clears WebView HTTP/image cache, leaving native VK account/session,
  WebView localStorage, cookies and app settings untouched; NO only closes it

Only the `apk` branch has changed. The web client, server, VK auth and
automatic GitHub builds remain untouched.

## Selected hero survives WebView navigation (0.3.5)

Issue: live `main/client/menu.js` reads the selected hero from
`localStorage['echo.selectedModel']`, but calls `ensureUnlockedSelection()`
before the asynchronous `/echo/api/heroes` inventory response arrives. It
mistakes previously unlocked heroes for locked ones and overwrites their
stored selection with a starter. A new Android WebView/arena then picks the
wrong model from localStorage.

Android workaround in `EchoHeroWebBootstrap.kt` (no production web edits):
- AndroidX WebKit's document-start injection executes **before** menu.js and
  game.js, scoped to `https://cat-fight.ru` + the `/echo/` path.
- Native ECHO authentication is set at document start, avoiding an initial
  anonymous page load and a redundant reload on supported WebViews.
- Until web hero ownership data arrives, the stored valid selected skin
  is preserved against programmatic premature starter resets. Legitimate
  taps on unlocked character cards continue to update the selection.
- The Heroes WebView re-selects the chosen card after the server's hero
  inventory is reflected in the clickable card state.
- A logout clears stale WebView login and the previously selected skin.
- Old WebView engines without `DOCUMENT_START_SCRIPT` keep the prior
  post-load authentication fallback; updating Android System WebView is
  recommended for complete selected-hero protection.

Test on device: log in -> open Heroes -> choose a legitimately unlocked hero
(non-default, preferably nonstarter) -> exit -> reopen Heroes and verify it
remains Active -> enter Arena and verify the model displayed/spawned -> reopen
Heroes. Then choose another hero and repeat. Also check logout/guest behavior.

This is an APK-specific guard; the same initial inventory race may still
occur in the website because main/client/menu.js has not been changed.
No purchases, advertising SDKs, Cat Fighting or server configuration were
modified.

## ECHO confirm modals for logout and arena exit (0.3.6)

The native settings and arena now reproduce `main/client/auth-ui.js` and
`main/client/game.js` confirmation behavior using the **same shared,
animated ECHO Compose modal** already used for clearing WebView cache.

- Account Settings -> Sign out opens `ВЫХОД` /
  `Вы уверены, что хотите выйти из аккаунта?` with `НЕТ` (dark) and
  `ДА` (white). Only `ДА` invokes native logout (clear session and
  asynchronously revoke its server bearer token).
- Arena top-right cross and device Back trigger `ВЫХОД ИЗ ИГРЫ` /
  `Вы действительно хотите покинуть игру?`. `НЕТ` keeps the active
  WebView and live match; `ДА` closes only the battle's Activity,
  returning to the native home. The original browser's `game-exit`
  button stays hidden inside the APK to prevent duplicate confirmations.
- Shop, Quests, Heroes, Code and Settings still go Back immediately.
  The pack-opening cross still closes *only the pack*, not the arena;
  no exit confirmation is added to that action.
- Confirmation windows retain CSS-equivalent black panel, white border,
  floating particles, and equal-width dark/light buttons. Browser `main`
  and backend are unchanged, and no GitHub Actions APK build runs.

Test: sign in -> Settings -> Sign Out -> No (remains signed in), then
Yes (logs out). Arena -> cross -> No (continue playing), then cross ->
Yes (return home). Repeat with Android system Back. Verify Pack Close
and the ordinary subpage Back icons remain unchanged.
