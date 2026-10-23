# ECHO Android: CSS parity audit (apk branch)

Source of truth: **`main/client/`** as of the CSS comparison. Do not modify the
production web client's styles just to make Android resemble them. Android's
native UI should import their layout *rules*; embedded WebView should use the
web files unchanged.

The audit covers all 20 client CSS files.

| CSS file | Where it applies | Android implementation |
| --- | --- | --- |
| `echo-font.css` | One global SchuelerSuperXP font | Bundled `R.font.echo_superxp` in Compose; web styles retained |
| `style.css` | Baseline black background, menu, back button, sliders/modals | Home/Settings style and back button mirrored in Compose; web elements keep original CSS |
| `ui-layout.css` | Height-based menu scale, home button flex sizing/gaps, titles, controls | `EchoCss.kt` and `EchoScreens.kt` implement viewport-height proportions |
| `menu-width.css` | `min(100dvh, 100vw - 40px)` common menu width | `EchoCss.contentWidth()` |
| `settings-refresh.css` | Settings section labels, fonts, uniform actions, account UI | Native labels, button sizes, fields/volume cards; web account UI preserved |
| `landscape-menu-layout.css` | Four-column hero cards, shop/quest landscape layouts, scrolling | **WebView original CSS**; not duplicated in native placeholders |
| `orientation.css` | Browser portrait rotation prompts | Native Activity locked landscape; web original unchanged |
| `auth.css` | Login widget, account card, nickname modal | **WebView original CSS**, native account API still planned |
| `character-cards.css` | Rarity, models, states, badges | **WebView original CSS**, including 3D preview |
| `shop.css` | Card pack layout and prices | **WebView original CSS**, no fake native purchase UI |
| `daily-quests.css` | Daily quests and arena HUD | **WebView original CSS** |
| `special-quests.css` | Five-tier and special quests | **WebView original CSS** |
| `pack-preview.css` | Pack illustration and opening | **WebView original CSS** |
| `pack-shop-3d.css` | Three-dimensional pack interaction | **WebView original CSS** |
| `pack-card-fan.css` | 3D card reveal fan | **WebView original CSS** |
| `fullscreen.css` | Game navigation and fullscreen controls | **WebView original CSS**; fullscreen button hidden in Android |
| `room-leaderboard.css` | Arena room leaderboard | **WebView original CSS** |
| `round-results.css` | Arena round rewards | **WebView original CSS** |
| `world-minimap.css` | Arena minimap and map controls | **WebView original CSS** |
| `toast.css` | Web toasts | **WebView original CSS** |

## Fixed compared with Android 0.2.2

- Main screen: five equal-height buttons **fill** available vertical space, with
  `clamp(16px,40px * scale,52px)` gaps instead of hard-coded 8dp.
- Logo: scale from `clamp(32px,54px * scale,70px)`, letter spacing `.38em`,
  soft cool-white text glow and original bundled font.
- Unified menu width: constrained by landscape viewport height and 20px gutters.
- Settings: left-aligned uppercase section labels, original language flags,
  `clamp(48px,58px * scale,96px)` button height, matched button labels
  and outlined music/effects controls.
- Native back buttons: original black surface, 1dp white outline,
  13dp corners, shared responsive width and screen-specific heights.
- WebView: no CSS override padding or `display:none` for original back
  buttons: use `visibility:hidden` to preserve their reserved layout area.
  All other page styles remain from the actual website.

## Important limitations

- Native dp/sp metrics and web CSS px are *not* exactly the same units; physical
  typography and touch-target sizes can vary with display density and font scale.
  Verify visual parity in Android Studio on a real landscape device.
- **WebView loading is a separate issue from CSS parity.** If Arena/Shop/Heroes
  show black, use the debug-only `?` overlay or Logcat's `EchoWebView`.
  CSS adjustments cannot fix a failed JavaScript module, WebGL context or HTTPS
  connection; the user-visible outcome must be checked on device.
- WebView screens are not converted to native Kotlin screens. Do not display
  mock collections/balances/quest progress until real server data is connected.
- New CSS work in `main` may require an explicit future parity check in `apk`.
- Gradle/APK builds are performed in Android Studio, not GitHub Actions.
