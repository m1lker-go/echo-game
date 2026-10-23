# ECHO Android — experimental APK branch

This folder is an **independent Android Studio project**. It does not change or bundle the ECHO website, backend, or the production deployment.

## Open the Android project

1. In Android Studio, switch Git branch from main to apk and pull.
2. Select **File > Open**, then select the **android** folder inside the cloned echo-game repository (not the repository root).
3. Trust the project, choose the bundled Gradle wrapper, and allow Gradle sync/download of SDK 35 if requested.
4. Select the **app** run configuration, connect a physical Android phone with USB debugging (or an emulator), and press Run.
5. The app is intentionally locked to landscape.

Gradle versions: Android Gradle Plugin 8.9.2, Gradle 8.11.1, Kotlin/Compose compiler 2.0.21, JDK 17. Uses the official Gradle wrapper scripts and JAR.

## What works in the initial build

- Native Jetpack Compose start menu and Android navigation.
- Native initial pages for Heroes, Shop, Quests, Account and Settings (informational scaffolds; server-backed features will be added in later steps).
- One disposable WebView opened as needed for the existing **arena** at https://cat-fight.ru/echo/?play=1&apk=1.
- Temporary WebView compatibility mode for the website's existing 3D hero gallery and pack view, launched from their native pages.
- Landscape, immersive fullscreen, WebGL hardware acceleration, native back/close control.
- Network error screen with retry button.

## Limitations and next steps

- Heroes and pack opening currently use the *existing site menu* inside WebView; the website has NOT yet been refactored into standalone viewer pages. Native data-driven heroes, quests, shop, account and purchases are NOT implemented yet.
- Native account login, purchase integrations, rewarded ads, push notifications, and server API synchronization are future stages.
- WebView shares the deployed game's server, but its cookies/localStorage are separate from the desktop/VK browsers; do not expect an automatically signed-in VK account.
- WebGL performance must be tested on real devices; no APK build or physical device verification has been performed by this commit.
- ECHO relies on the live website and an active internet connection. This is not an offline APK.

## Safety boundaries

- No JavaScript bridge is exported to untrusted pages.
- Only HTTPS pages under cat-fight.ru/echo/ load inside WebView; external HTTPS links open in the system browser.
- Never copy Cat Fighting's Android package name, activity files, or credentials into this application.
- Production ECHO is deployed from main; keep all Android work on apk until reviewed.
