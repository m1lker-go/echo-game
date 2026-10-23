package ru.echo.game

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

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
    private lateinit var auth: EchoAuthSession
    private var page = Page.ARENA
    private var crashed = false
    private var sessionBootstrapped = false
    private var latestError = ""
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

        val back = TextView(this).apply {
            text = if (page == Page.ARENA) "✕" else "НАЗАД"
            gravity = Gravity.CENTER
            textSize = if (page == Page.ARENA) 22f else 19f
            setTextColor(Color.WHITE)
            typeface = runCatching { resources.getFont(R.font.echo_superxp) }
                .getOrNull() ?: Typeface.DEFAULT_BOLD
            background = panelBackground()
            setOnClickListener { finish() }
        }
        val backParams = if (page == Page.ARENA) {
            FrameLayout.LayoutParams(dp(44), dp(44), Gravity.TOP or Gravity.START).apply {
                topMargin = dp(10); leftMargin = dp(10)
            }
        } else {
            val metrics = resources.displayMetrics
            FrameLayout.LayoutParams(
                minOf(metrics.heightPixels, metrics.widthPixels - dp(40)),
                dp(50), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            ).apply { bottomMargin = dp(8) }
        }
        root.addView(back, backParams)
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            val diagnose = TextView(this).apply {
                text = "?"; gravity = Gravity.CENTER; textSize = 18f
                setTextColor(Color.WHITE)
                background = panelBackground()
                setOnClickListener { showDiagnostic() }
            }
            root.addView(diagnose,
                FrameLayout.LayoutParams(dp(42), dp(42), Gravity.TOP or Gravity.END)
                    .apply { rightMargin = dp(10); topMargin = dp(10) })
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { finish() }
        })
        web.loadUrl(requestedUrl)
    }

    private fun panelBackground() = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(Color.BLACK)
        setStroke(dp(1), Color.WHITE)
        cornerRadius = dp(13).toFloat()
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
                    Log.i(TAG, "Native full-screen WebView loading: " + Uri.parse(url).path)
                }

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    if (crashed || !trusted(Uri.parse(url))) return

                    // The site's auth module reads localStorage at module load.
                    // Set the same-origin ECHO session, then reload just once.
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
                    val secondary = if (page == Page.CODE_VIEW) "settings-enter-code" else ""
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
                            style.textContent =
                              '#echo-fullscreen-toggle{display:none!important}' +
                              '#game-exit,#character-back,#quests-back,#shop-back,#settings-back{' +
                              'visibility:hidden!important;pointer-events:none!important}';
                            document.head.appendChild(style);
                          }
                          const opener = '$opener', secondary = '$secondary';
                          if (opener) {
                            let tries = 0;
                            const navigate = setInterval(() => {
                              const button = document.getElementById(opener);
                              if (button && typeof window.ECHO_SELECTED_MODEL === 'string') {
                                button.click(); clearInterval(navigate);
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
    }

    private fun showFailure(message: String) {
        if (isFinishing || isDestroyed) return
        latestError = message
        Log.e(TAG, message)
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            android.app.AlertDialog.Builder(this)
                .setTitle("ECHO WebView")
                .setMessage(message)
                .setPositiveButton("ПОВТОРИТЬ") { _, _ ->
                    if (!crashed) web.loadUrl(requestedUrl) else recreate()
                }
                .setNegativeButton("НАЗАД") { _, _ -> finish() }
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
        if (::web.isInitialized) {
            runCatching { web.stopLoading() }
            runCatching { root.removeView(web) }
            runCatching { web.destroy() }
        }
        super.onDestroy()
    }
}
