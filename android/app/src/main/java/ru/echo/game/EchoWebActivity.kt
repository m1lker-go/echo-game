package ru.echo.game

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import androidx.compose.ui.unit.dp

/**
 * Render WebGL in a platform WebView directly attached to the Activity window.
 * Separating it from Compose's AndroidView is a deliberate MIUI graphics
 * compatibility test, since ECHO's logs proved JS/models/socket already load.
 */
class EchoWebActivity : ComponentActivity() {
    companion object {
        const val EXTRA_PAGE = "echo.page"
        private const val BASE = "https://cat-fight.ru/echo/"
        private const val TAG = "EchoWebView"
    }
    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var nativeNav: EchoNavButton
    private lateinit var loading: EchoWebLoadingView
    private lateinit var auth: EchoAuthSession
    private var page = Page.ARENA
    private var crashed = false
    private var sessionBootstrapped = false
    private var documentStartInstalled = false
    private var latestError = ""
    private var loadSequence = 0
    private var failureDialogOpen = false
    private var packDialogOpen = false
    private var arenaExitDialogOpen = false
    private var arenaExitDialogHost: ComposeView? = null
    private val requestedUrl get() = if (page == Page.ARENA) BASE + "?play=1" else BASE
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        page = Page.entries.firstOrNull { it.name == intent.getStringExtra(EXTRA_PAGE) }
            ?: Page.ARENA
        auth = EchoAuthSession(applicationContext)
        window.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
        window.setBackgroundDrawableResource(android.R.color.black)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        setContentView(root)
        createWebView()
        // Opaque native overlay: no intermediate webpage menu can flash.
        loading = EchoWebLoadingView(this)
        root.addView(loading, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ))
        loading.restart()


        // main/client/fullscreen.css: one square top-right control per page.
        // Arena = close X, menu subpages = back chevron. No fullscreen control.
        nativeNav = EchoNavButton(
            this, if (page == Page.ARENA) EchoNavButton.Mode.CLOSE
                  else EchoNavButton.Mode.BACK
        ).apply {
            setOnClickListener { navigateBack() }
            if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                setOnLongClickListener { showDiagnostic(); true }
            }
        }
        val metrics = resources.displayMetrics
        val density = metrics.density
        val viewportWidth = (metrics.widthPixels / density).dp
        val css = EchoCss((metrics.heightPixels / density).dp)
        val navSize = (css.navigationSize(viewportWidth).value * density).toInt()
        val navRight = (css.navigationRight(viewportWidth).value * density).toInt()
        val navTop = (css.navigationTop.value * density).toInt()
        root.addView(
            nativeNav,
            FrameLayout.LayoutParams(navSize, navSize, Gravity.TOP or Gravity.END).apply {
                rightMargin = navRight
                topMargin = navTop
            }
        )
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { navigateBack() }
        })
        web.loadUrl(requestedUrl)
    }

    // Keep pack closing independent; only leaving the actual arena needs
    // the confirmation implemented in main/client/game.js.
    private fun navigateBack() {
        if (arenaExitDialogOpen) {
            dismissArenaExitDialog()
            return
        }
        if (packDialogOpen && ::web.isInitialized) {
            web.evaluateJavascript(
                "document.getElementById('echo-pack-3d-close')?.click()", null
            )
            return
        }
        if (page == Page.ARENA) showArenaExitDialog()
        else finish()
    }

    private fun showArenaExitDialog() {
        if (arenaExitDialogOpen || isFinishing || isDestroyed) return
        arenaExitDialogOpen = true
        val lang = getSharedPreferences("echo.android.preferences", MODE_PRIVATE)
            .getString("language", "ru")
        val english = lang == "en"
        val host = ComposeView(this).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
        }
        arenaExitDialogHost = host
        // Compose Dialog creates its own modal window; the 1px host is only
        // needed to attach it to this ComponentActivity's lifecycle.
        root.addView(host, FrameLayout.LayoutParams(1, 1))
        host.setContent {
            EchoConfirmDialog(
                title = if (english) "EXIT GAME" else "ВЫХОД ИЗ ИГРЫ",
                message = if (english) "Do you really want to leave the game?"
                          else "Вы действительно хотите покинуть игру?",
                cancelLabel = if (english) "NO" else "НЕТ",
                confirmLabel = if (english) "YES" else "ДА",
                onDismiss = { dismissArenaExitDialog() },
                onConfirm = {
                    dismissArenaExitDialog()
                    // Finishing the WebView Activity disconnects the arena and
                    // returns to the native home, matching main's leave game.
                    finish()
                }
            )
        }
    }

    private fun dismissArenaExitDialog() {
        arenaExitDialogOpen = false
        arenaExitDialogHost?.let { host ->
            arenaExitDialogHost = null
            if (::root.isInitialized) root.removeView(host)
            // DisposeOnDetachedFromWindow ensures the Dialog disappears too.
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            // Never force a SOFTWARE layer; WebGL needs hardware acceleration.
            isVerticalScrollBarEnabled = false
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.setSupportZoom(false)
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.mediaPlaybackRequiresUserGesture = false
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    // DOM-only signal from the injected same-origin observer below.
                    // No sensitive data crosses this channel.
                    if (message.message() == "ECHO_ANDROID_PACK:open" ||
                        message.message() == "ECHO_ANDROID_PACK:closed") {
                        packDialogOpen = message.message().endsWith("open")
                        nativeNav.setMode(
                            if (packDialogOpen || page == Page.ARENA)
                                EchoNavButton.Mode.CLOSE else EchoNavButton.Mode.BACK
                        )
                        return true
                    }
                    if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                        latestError = message.message().take(220)
                        Log.e(TAG, "JS error in " + message.sourceId() +
                            ":" + message.lineNumber() + " — see in-app diagnostics")
                    }
                    return true
                }
            }
            webViewClient = object : WebViewClient() {
                private fun trusted(uri: Uri) =
                    uri.scheme == "https" && uri.host.equals("cat-fight.ru", ignoreCase = true) &&
                        (uri.path == "/echo" || uri.path.orEmpty().startsWith("/echo/"))

                override fun shouldOverrideUrlLoading(
                    view: WebView, request: WebResourceRequest
                ): Boolean {
                    if (trusted(request.url)) return false
                    if (request.isForMainFrame &&
                        request.url.scheme in listOf("https", "http")) {
                        runCatching {
                            startActivity(Intent(Intent.ACTION_VIEW, request.url))
                        }.onFailure { Log.e(TAG, "External navigation failed", it) }
                    }
                    return true
                }

                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    packDialogOpen = false
                    nativeNav.setMode(if (page == Page.ARENA)
                        EchoNavButton.Mode.CLOSE else EchoNavButton.Mode.BACK)
                    loadSequence++
                    loading.restart()
                    Log.i(TAG, "Native full-screen WebView loading: " + Uri.parse(url).path)
                }

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    if (crashed || !trusted(Uri.parse(url))) return

                    // On modern WebViews the trusted document-start bootstrap
                    // has already synchronized auth and protected hero choice.
                    // Legacy WebViews still use the post-load/reload fallback.
                    if (documentStartInstalled && auth.clearWebSession) {
                        view.evaluateJavascript(
                            "(function(){try{return !localStorage.getItem('echo.authToken');}catch(e){return false;}})()"
                        ) { cleared -> if (cleared == "true") auth.webSessionCleared() }
                    }
                    if (!sessionBootstrapped) {
                        val token = auth.token()
                        if (token != null || auth.clearWebSession) {
                            sessionBootstrapped = true
                            val script = if (token != null) {
                                "(function(){try {localStorage.setItem('echo.authToken'," +
                                    JSONObject.quote(token) + ");return true;} catch(e) {return false;}})()"
                            } else {
                                "(function(){try {localStorage.removeItem('echo.authToken');return true;} catch(e) {return false;}})()"
                            }
                            view.evaluateJavascript(script) { result ->
                                if (result == "true") {
                                    auth.webSessionCleared()
                                    view.loadUrl(requestedUrl)
                                } else showFailure("Не удалось сохранить сессию ECHO")
                            }
                            return
                        }
                    }

                    val opener = when (page) {
                        Page.HEROES, Page.HERO_VIEW -> "menu-character-button"
                        Page.SHOP, Page.PACK_VIEW -> "menu-shop"
                        Page.QUESTS -> "menu-quests"
                        Page.ACCOUNT, Page.CODE_VIEW -> "menu-settings"
                        else -> ""
                    }
                    val secondary = when (page) {
                        Page.CODE_VIEW -> "settings-enter-code"
                        Page.ACCOUNT -> "echo-open-login"
                        else -> ""
                    }
                    val audio = getSharedPreferences("echo.android.preferences", MODE_PRIVATE)
                    val musicVolume = audio.getFloat("musicVolume", .6f).coerceIn(0f, 1f)
                    val sfxVolume = audio.getFloat("sfxVolume", .7f).coerceIn(0f, 1f)
                    val language = audio.getString("language", "ru") ?: "ru"
                    val script = """
                        (function() {
                          let attempts = 0, soundReady = false, localeReady = false;
                          const timer = setInterval(() => {
                            if (!localeReady && window.ECHOI18n) {
                              window.ECHOI18n.setLanguage('$language'); localeReady = true;
                            }
                            if (!soundReady && window.ECHOAudio) {
                              window.ECHOAudio.setMusicVolume($musicVolume);
                              window.ECHOAudio.setSfxVolume($sfxVolume);
                              soundReady = true;
                            }
                            if ((localeReady && soundReady) || attempts++ > 40) clearInterval(timer);
                          }, 150);
                          if (!document.getElementById('echo-android-style')) {
                            const style = document.createElement('style');
                            style.id = 'echo-android-style';
                            // Native top-right icon replaces the web navigation;
                            // bottom Back and browser fullscreen stay completely removed.
                            style.textContent =
                              '#echo-fullscreen-toggle,#game-exit,' +
                              '#character-back,#quests-back,#shop-back,#settings-back,' +
                              '#placeholder-back{display:none!important;pointer-events:none!important}' +
                              '#echo-pack-3d-close{visibility:hidden!important;pointer-events:none!important}';
                            // When a pack opens, the native top-right control
                            // switches Back → Close. Keep the original click handler.
                            const pack = document.getElementById('echo-pack-3d');
                            if (pack && !pack.dataset.echoNativeNavObserved) {
                              pack.dataset.echoNativeNavObserved = '1';
                              const report = () => console.info(
                                'ECHO_ANDROID_PACK:' + (pack.hidden ? 'closed' : 'open')
                              );
                              new MutationObserver(report).observe(
                                pack, {attributes:true,attributeFilter:['hidden']}
                              );
                              report();
                            }
                            document.head.appendChild(style);
                          }
                          const opener = '$opener', secondary = '$secondary';
                          if (opener) {
                            let tries = 0;
                            const navigate = setInterval(() => {
                              const button = document.getElementById(opener);
                              if (button && typeof window.ECHO_SELECTED_MODEL === 'string') {
                                button.click(); clearInterval(navigate);
                                // For the Heroes page, the server's hero collection
                                // loads AFTER menu.js's early fallback check.
                                // Reapply the preserved selection once ownership
                                // has been confirmed and its card is clickable.
                                if (opener === 'menu-character-button') {
                                  const wanted = localStorage.getItem('echo.selectedModel');
                                  if (wanted) {
                                    let restoreAttempts = 0;
                                    const restore = setInterval(() => {
                                      if (localStorage.getItem('echo.selectedModel') !== wanted ||
                                          window.ECHO_SELECTED_MODEL === wanted) {
                                        clearInterval(restore); return;
                                      }
                                      const card = Array.from(
                                        document.querySelectorAll('#character-grid [data-model]')
                                      ).find(el => el.dataset.model === wanted);
                                      if (card && card.getAttribute('aria-disabled') === 'false' &&
                                          !card.classList.contains('is-locked')) {
                                        card.click();
                                        clearInterval(restore);
                                        return;
                                      }
                                      if (++restoreAttempts >= 120) clearInterval(restore);
                                    }, 150);
                                  }
                                }
                                if (secondary) setTimeout(() => {
                                  document.getElementById(secondary)?.click();
                                }, 350);
                              }
                              if (++tries >= 60) clearInterval(navigate);
                            }, 200);
                          }
                        })()
                    """.trimIndent()
                    view.evaluateJavascript(script, null)
                    // Keep the native loading veil above the web menu until the
                    // requested page is visible (not merely until HTML finishes).
                    val sequence = loadSequence
                    view.postDelayed({ pollPageReady(view, sequence, 0) }, 180L)
                    // A DOM ready event is NOT proof of a visible WebGL frame.
                    view.postDelayed({
                        if (!crashed) {
                            val code = """
                                (function() {
                                  const world=document.getElementById('world');
                                  const models=document.getElementById('models');
                                  return JSON.stringify({
                                    menuHidden:document.getElementById('main-menu')?.classList.contains('is-hidden'),
                                    world:[world?.width,world?.height],
                                    models:[models?.width,models?.height],
                                    viewport:[innerWidth,innerHeight]
                                  });
                                })()
                            """.trimIndent()
                            view.evaluateJavascript(code) { result ->
                                Log.i(TAG, "WebView canvas/DOM: " + result.take(480))
                            }
                        }
                    }, 2000)
                }

                override fun onReceivedError(
                    view: WebView, request: WebResourceRequest, error: WebResourceError
                ) {
                    if (request.isForMainFrame) showFailure("Ошибка ECHO: " + error.description)
                    else Log.w(TAG, "Resource failed: " + request.url.path)
                }

                override fun onReceivedHttpError(
                    view: WebView, request: WebResourceRequest, response: WebResourceResponse
                ) {
                    if (request.isForMainFrame && response.statusCode >= 400) {
                        showFailure("Сервер ECHO: HTTP " + response.statusCode)
                    }
                }

                override fun onReceivedSslError(
                    view: WebView, handler: SslErrorHandler, error: SslError
                ) {
                    handler.cancel()
                    showFailure("Ошибка HTTPS ECHO")
                }

                override fun onRenderProcessGone(
                    view: WebView, detail: RenderProcessGoneDetail
                ): Boolean {
                    crashed = true
                    showFailure("WebView/WebGL остановился — попробуй повторить")
                    return true
                }
            }
        }
        root.addView(web, 0, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // Install before the FIRST loadUrl(). ECHO's menu.js and game.js read
        // the chosen model synchronously, before onPageFinished ever fires.
        documentStartInstalled = EchoHeroWebBootstrap.install(web, auth)
        if (documentStartInstalled) sessionBootstrapped = true
    }

    /**
     * The HTML entrypoint is shared by Arena/Heroes/Shop/Quests. The website
     * briefly opens its home menu before menu.js handles the requested click.
     * Keep the native full-screen loading surface up until that click succeeds.
     */
    private fun pollPageReady(view: WebView, sequence: Int, attempt: Int) {
        if (isFinishing || isDestroyed || crashed || failureDialogOpen ||
            sequence != loadSequence || loading.visibility != View.VISIBLE) return
        val target = when (page) {
            Page.ARENA -> "arena"
            Page.HEROES, Page.HERO_VIEW -> "character"
            Page.SHOP, Page.PACK_VIEW -> "shop"
            Page.QUESTS -> "quests"
            Page.ACCOUNT -> "account"
            Page.CODE_VIEW -> "code"
            else -> "menu"
        }
        val script = """
            (function() {
              const menu = document.getElementById('main-menu');
              if (!menu || document.readyState !== 'complete' ||
                  typeof window.ECHO_SELECTED_MODEL !== 'string') return false;
              const shown = id => {
                const node = document.getElementById(id);
                if (!node || node.hidden) return false;
                const css = getComputedStyle(node);
                return css.display !== 'none' && css.visibility !== 'hidden';
              };
              switch (${JSONObject.quote(target)}) {
                case 'arena':
                  return menu.classList.contains('is-hidden') &&
                         document.getElementById('world')?.width > 1 &&
                         document.getElementById('models')?.width > 1;
                case 'character':
                  return shown('menu-character');
                case 'shop':
                  return shown('menu-shop-screen') &&
                         !!document.querySelector('.echo-shop-pack');
                case 'quests':
                  return shown('menu-quests-screen');
                case 'code':
                  return shown('menu-settings-screen') &&
                         !!document.querySelector('.echo-code-modal-content .echo-code-input');
                case 'account':
                  return shown('menu-settings-screen') &&
                         !!document.querySelector('.echo-login-widget');
                default:
                  return shown('menu-main');
              }
            })()
        """.trimIndent()
        view.evaluateJavascript(script) { result ->
            if (isFinishing || isDestroyed || crashed ||
                sequence != loadSequence || loading.visibility != View.VISIBLE) {
                return@evaluateJavascript
            }
            if (result == "true") {
                // Permit a couple of display frames for WebGL/DOM compositing.
                view.postDelayed({
                    if (!isFinishing && !isDestroyed && !crashed &&
                        sequence == loadSequence && loading.visibility == View.VISIBLE) {
                        loading.visibility = View.GONE
                        Log.i(TAG, "Requested screen visible: " + page.name)
                    }
                }, 180L)
            } else if (attempt < 125) {
                view.postDelayed({ pollPageReady(view, sequence, attempt + 1) }, 150L)
            } else {
                showFailure("Раздел ECHO не открылся. Проверь интернет и повтори.")
            }
        }
    }

    private fun showFailure(message: String) {
        if (isFinishing || isDestroyed) return
        latestError = message
        Log.e(TAG, message)
        runOnUiThread {
            if (isFinishing || isDestroyed || failureDialogOpen) return@runOnUiThread
            failureDialogOpen = true
            loadSequence++ // Cancel any pending successful readiness probe.
            loading.restart()
            android.app.AlertDialog.Builder(this)
                .setTitle("ECHO WebView")
                .setMessage(message)
                .setPositiveButton("ПОВТОРИТЬ") { _, _ ->
                    failureDialogOpen = false
                    if (!crashed) web.loadUrl(requestedUrl) else recreate()
                }
                .setNegativeButton("НАЗАД") { _, _ ->
                    failureDialogOpen = false
                    finish()
                }
                .setOnCancelListener {
                    failureDialogOpen = false
                    finish()
                }
                .show()
        }
    }

    private fun showDiagnostic() {
        val probe = """
            (function() {
              const m=document.getElementById('main-menu');
              const world=document.getElementById('world');
              const models=document.getElementById('models');
              const rect=world?.getBoundingClientRect();
              const gl=models?.getContext('webgl2')||models?.getContext('webgl');
              return JSON.stringify({
                document: document.readyState,
                menuHidden: !!m?.classList.contains('is-hidden'),
                menuVisibility: m&&getComputedStyle(m).visibility,
                worldPx:[world?.width,world?.height],
                worldBounds: rect ? [rect.width,rect.height] : null,
                modelsPx:[models?.width,models?.height],
                webgl: !!gl, contextLost: gl?.isContextLost(),
                screen:[innerWidth,innerHeight],
                active:document.visibilityState
              });
            })()
        """.trimIndent()
        web.evaluateJavascript(probe) { result ->
            val details = runCatching { JSONObject(result).toString(2) }.getOrDefault(result)
            android.app.AlertDialog.Builder(this)
                .setTitle("ECHO — WebView")
                .setMessage(details.take(1800) +
                    (if (latestError.isNotBlank()) "\nОшибка: " + latestError else ""))
                .setPositiveButton("ЗАКРЫТЬ", null)
                .show()
        }
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.onResume()
    }

    override fun onPause() {
        if (::web.isInitialized) web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        dismissArenaExitDialog()
        if (::web.isInitialized) {
            runCatching { web.stopLoading() }
            runCatching { root.removeView(web) }
            runCatching { web.destroy() }
        }
        super.onDestroy()
    }
}
