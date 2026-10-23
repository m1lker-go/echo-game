# ECHO APK: VK ID native sign-in

This implementation is intentionally based on the working Cat Fighting Android
pattern in `m1lker-go/fight-club`, branch `android-apk`, but uses **ECHO's own**
VK ID app and backend.

## What is already wired into the APK branch

1. Native VK SDK `com.vk.id:vkid:2.7.3`, initialized in `EchoApplication`.
2. The Settings account button launches `VKID.instance.authorize(activity, callback)`,
   not the web VK ID OAuthList which previously redirected into Chrome.
3. VK's native `AccessToken` is exchanged by HTTPS POST
   `https://cat-fight.ru/echo/api/auth/vk`, JSON: `{"accessToken":"..."}`.
   Server verifies the token against ECHO's VK ID app, then returns
   `{token,nickname,accountId}` (ECHO's own session, not Cat Fighting's).
4. App-private SharedPreferences store only the ECHO session and nickname.
   WebView receives `echo.authToken` in same-origin `localStorage`, then loads
   the requested ECHO page again so the original website auth module sees it.
   No access token or session token appears in the URL or Logcat.
5. Native logout clears local state and sends `/echo/api/auth/logout` to revoke
   the server token. Next WebView visit also clears stale web `echo.authToken`.

## VK ID app configuration is required

The current ECHO web VK ID app id is **54832804**, NOT Cat Fighting's
54525890. For native login, in ECHO's VK ID developer portal add/configure an
Android client for **package `ru.echo.game`**, including the debug and production
SHA-1 signing certificate fingerprints and SDK redirect settings. Confirm that
app id 54832804 can be used with your Android registration. If the portal gives
a distinct Android app id, the ECHO server VK ID config and SDK must agree
before using it; do not silently substitute Cat Fighting's id.

To obtain the debug SHA-1:
Android Studio -> Gradle -> `:app:signingReport` (or use keytool against
your own `~/.android/debug.keystore`). Release keys use a different SHA-1.

**Never commit or send the protected VK ID client key.** Locally set in
`~/.gradle/gradle.properties` (on Windows, `%USERPROFILE%\.gradle\gradle.properties`):

```properties
ECHO_VK_CLIENT_SECRET=YOUR_ECHO_VK_ID_CLIENT_SECRET
```

Alternatively provide it as an `ECHO_VK_CLIENT_SECRET` environment variable.
This value is used only to configure the Android VK ID SDK and is not an ECHO
backend or Cat Fighting secret. Like other SDK client credentials included in
an Android binary, it cannot be treated as an undiscoverable server-side secret.

Without the value, APK builds are allowed so the game's UI remains testable,
but the native VK button will explicitly say configuration is required. The
web OAuthList will *not* silently run as a fallback in the system browser.

## Testing

- Switch to `apk`, Git > Pull. Open `android/` and allow Gradle Sync to
  fetch the VK ID SDK and placeholders plugin from VK's official Nexus.
- Run in Android Studio on a device with the debug signing SHA-1 configured.
- Settings -> **ВОЙТИ ЧЕРЕЗ VK**. VK ID can use the installed VK app or a
  browser Custom Tab, but its result must reach the **original Activity**.
- After sign-in, Settings should show the account's nickname without opening
  `https://cat-fight.ru/echo/` in a separate browser.
- Open Shop/Quests and verify authenticated balance/quests once WebView
  itself is functioning; these are still web pages in the hybrid shell.
- Sign out and verify the account state is cleared.

If SDK fails or WebView remains black, use Logcat filters `EchoVKID` and
`EchoWebView`. Do not include bearer tokens when sharing logs.

## Limits

VK ID app registration and key are external requirements: they are not present
in the repository and cannot be confirmed via a source code review. SDK login
must be tested on the user's phone in Android Studio. This implementation does
not fix the separate black WebView issue or replace VK ID account setup.
