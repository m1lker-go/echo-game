package ru.echo.game

import android.content.Intent
import android.graphics.Color as AndroidColor
import android.graphics.drawable.ColorDrawable
import android.graphics.Bitmap
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.net.http.SslError
import android.util.Log
import android.widget.Toast
import com.vk.id.VKID
import com.vk.id.AccessToken
import com.vk.id.auth.VKIDAuthCallback
import com.vk.id.VKIDAuthFail
import org.json.JSONObject
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.SslErrorHandler
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlinx.coroutines.delay

private const val WEB_BASE = "https://cat-fight.ru/echo/"
private val Background = Color(0xFF000000)
private val Panel = Color(0xFF111820)
private val Accent = Color(0xFFF1F4F7)
private val Muted = Color(0xFF96A8B7)

internal enum class Page {
    HOME, HEROES, SHOP, QUESTS, SETTINGS,
    ARENA, HERO_VIEW, PACK_VIEW, ACCOUNT, CODE_VIEW
}

class MainActivity : ComponentActivity() {
    private lateinit var echoAudio: EchoAudioEngine
    private lateinit var echoAuth: EchoAuthSession
    private var vkLoginInProgress = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        echoAudio = EchoAudioEngine(applicationContext)
        echoAuth = EchoAuthSession(applicationContext)
        echoAuth.token()?.let { previous ->
            Thread {
                runCatching { echoAuth.checkSession(previous) }.onSuccess { freshName ->
                    // Token may have been logged out while this request was in flight.
                    if (echoAuth.token() == previous && freshName.isNotBlank()) runOnUiThread {
                        if (echoAuth.token() == previous) echoAuth.updateNickname(freshName)
                    }
                }
            }.start()
        }
        window.setBackgroundDrawable(ColorDrawable(AndroidColor.BLACK))
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        setContent {
            MaterialTheme {
                EchoAndroidShell(echoAudio, echoAuth, onVkLogin = ::startVkLogin,
                    onLogout = ::logoutEcho)
            }
        }
    }


    private fun startVkLogin() {
        if (vkLoginInProgress || echoAuth.busy) return
        if (!BuildConfig.ECHO_VK_CONFIGURED) {
            echoAuth.message = "Для входа VK настрой ECHO_VK_CLIENT_SECRET в Android Studio (не ключ Cat Fighting)."
            return
        }
        vkLoginInProgress = true
        echoAuth.busy = true
        echoAuth.message = null
        try {
            VKID.instance.authorize(this, vkAuthCallback)
        } catch (error: Exception) {
            vkLoginInProgress = false
            echoAuth.busy = false
            echoAuth.message = "VK ID не запустился: " + (error.message ?: "ошибка")
            Log.e("EchoVKID", "VK ID authorize failed", error)
        }
    }

    private val vkAuthCallback = object : VKIDAuthCallback {
        override fun onAuth(accessToken: AccessToken) {
            // Unlike Web VK ID widget, the native SDK calls back to the Activity,
            // not to the ordinary browser at https://cat-fight.ru/echo/.
            val vkToken = accessToken.token
            Thread {
                val result = runCatching { echoAuth.exchangeVkToken(vkToken) }
                runOnUiThread {
                    vkLoginInProgress = false
                    echoAuth.busy = false
                    result.onSuccess {
                        echoAuth.accept(it)
                        Toast.makeText(this@MainActivity, "Вы вошли в ECHO", Toast.LENGTH_SHORT).show()
                    }.onFailure {
                        echoAuth.message = it.message ?: "Не удалось войти в ECHO через VK"
                        Log.e("EchoVKID", "ECHO session exchange failed (no tokens logged)", it)
                    }
                }
            }.start()
        }

        override fun onFail(fail: VKIDAuthFail) {
            vkLoginInProgress = false
            echoAuth.busy = false
            echoAuth.message = "Вход через VK отменён или не выполнен"
        }
    }

    private fun logoutEcho() {
        val existing = echoAuth.token()
        echoAuth.clearSession()
        if (existing != null) Thread { echoAuth.logoutServer(existing) }.start()
    }

    override fun onResume() {
        super.onResume()
        if (::echoAudio.isInitialized) echoAudio.setForeground(true)
    }

    override fun onPause() {
        if (::echoAudio.isInitialized) echoAudio.setForeground(false)
        super.onPause()
    }

    override fun onDestroy() {
        if (::echoAudio.isInitialized) echoAudio.release()
        super.onDestroy()
    }
}

@Composable
internal fun WebPage(page: Page, onBack: () -> Unit, audio: EchoAudioEngine, auth: EchoAuthSession) {
    val context = LocalContext.current
    var failed by remember(page) { mutableStateOf(false) }
    var loaded by remember(page) { mutableStateOf(false) }
    var retry by remember(page) { mutableIntStateOf(0) }
    var failureMessage by remember(page) { mutableStateOf("") }
    var lastConsoleError by remember(page) { mutableStateOf("") }
    var progress by remember(page) { mutableIntStateOf(0) }
    var debugDetails by remember(page) { mutableStateOf("") }
    var showDebug by remember(page) { mutableStateOf(false) }
    val debugWebView = remember(page, retry) { mutableStateOf<WebView?>(null) }
    val isDebugBuild =
        (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    LaunchedEffect(page, retry) {
        delay(20000)
        if (!loaded && !failed) {
            failureMessage = "ECHO не завершила загрузку за 20 секунд. Проверь интернет и WebView."
            failed = true
        }
    }
    val url = when (page) {
        Page.ARENA -> WEB_BASE + "?play=1"
        else -> WEB_BASE
    }
    val opener = when (page) {
        Page.HEROES, Page.HERO_VIEW -> "menu-character-button"
        Page.SHOP, Page.PACK_VIEW -> "menu-shop"
        Page.QUESTS -> "menu-quests"
        Page.ACCOUNT, Page.CODE_VIEW -> "menu-settings"
        else -> ""
    }
    val additional = when (page) {
        Page.CODE_VIEW -> "settings-enter-code"
        Page.ACCOUNT -> "echo-open-login"
        else -> ""
    }
    val music = audio.musicVolume
    val sfx = audio.sfxVolume
    val language = audio.language

    BoxWithConstraints(Modifier.fillMaxSize().background(Background)) {
        val css = EchoCss(maxHeight)
        val nativeBackWidth = css.contentWidth(maxWidth)
        val nativeBackHeight = when (page) {
            Page.ACCOUNT, Page.CODE_VIEW -> css.settingsButtonHeight
            Page.SHOP, Page.PACK_VIEW ->
                (maxHeight.value * .07f).coerceIn(34f, 52f).dp
            else -> css.menuBackHeight
        }
        val nativeBackFontSp = when (page) {
            Page.ACCOUNT, Page.CODE_VIEW -> css.settingsButtonFontSp
            else -> css.menuBackFontSp
        }
        key(page, retry) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = {
                    WebView(context).apply {
                        setBackgroundColor(AndroidColor.BLACK)
                        // Android hardware acceleration is already enabled in the manifest.
                        // Forcing a WebView layer can cause black output on some GPUs.
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.setSupportZoom(false)
                        settings.javaScriptCanOpenWindowsAutomatically = false
                        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        settings.mediaPlaybackRequiresUserGesture = false
                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView, newProgress: Int) {
                                progress = newProgress
                                super.onProgressChanged(view, newProgress)
                            }

                            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                                val detail = message.message()
                                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                                    lastConsoleError = detail.take(250)
                                    Log.e("EchoWebView", "JS: " + detail + " (" + message.sourceId() + ":" + message.lineNumber() + ")")
                                }
                                return super.onConsoleMessage(message)
                            }
                        }
                        webViewClient = object : WebViewClient() {
                            private var mainFrameBroken = false

                            private fun trusted(address: Uri): Boolean {
                                return address.scheme == "https" &&
                                    (address.host == "cat-fight.ru" || address.host == "www.cat-fight.ru") &&
                                    (address.path == "/echo" || address.path.orEmpty().startsWith("/echo/"))
                            }

                            private fun fail(reason: String) {
                                mainFrameBroken = true
                                failureMessage = reason
                                loaded = false
                                failed = true
                                Log.e("EchoWebView", reason)
                            }

                            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                                super.onPageStarted(view, url, favicon)
                                mainFrameBroken = false
                                failed = false
                                loaded = false
                                failureMessage = ""
                                progress = 0
                                lastConsoleError = ""
                                Log.d("EchoWebView", "Loading: " + url)
                            }

                            override fun shouldOverrideUrlLoading(
                                view: WebView, request: WebResourceRequest
                            ): Boolean {
                                val target = request.url
                                if (trusted(target)) return false
                                if (request.isForMainFrame && target.scheme in listOf("https", "http")) {
                                    runCatching {
                                        context.startActivity(Intent(Intent.ACTION_VIEW, target))
                                    }.onFailure {
                                        Log.e("EchoWebView", "External link failure: " + target, it)
                                    }
                                }
                                return true
                            }

                            override fun onReceivedError(
                                view: WebView, request: WebResourceRequest, error: WebResourceError
                            ) {
                                if (request.isForMainFrame) {
                                    fail("Ошибка загрузки ECHO: " + error.description.toString() +
                                        " (код " + error.errorCode + ")")
                                } else {
                                    Log.w("EchoWebView", "Resource error: " + request.url +
                                        " / " + error.description)
                                }
                            }

                            override fun onReceivedHttpError(
                                view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse
                            ) {
                                if (request.isForMainFrame && errorResponse.statusCode >= 400) {
                                    fail("Сервер ECHO вернул HTTP " + errorResponse.statusCode)
                                }
                            }

                            override fun onReceivedSslError(
                                view: WebView, handler: SslErrorHandler, error: SslError
                            ) {
                                handler.cancel()
                                fail("Ошибка сертификата HTTPS ECHO: " + error.primaryError)
                            }

                            override fun onRenderProcessGone(
                                view: WebView, detail: RenderProcessGoneDetail
                            ): Boolean {
                                // ECHO's WebGL renderer may exceed device GPU resources.
                                // Let the user retry rather than leaving a permanently black view.
                                fail("Процесс WebView остановился. Попробуй повторить запуск или обновить Android System WebView.")
                                return true
                            }

                            override fun onPageFinished(view: WebView, url: String) {
                                super.onPageFinished(view, url)
                                // onPageFinished runs even after network/SSL errors. Never
                                // turn an error page into an unexplained black screen.
                                if (mainFrameBroken) return
                                val finalUri = Uri.parse(url)
                                if (!trusted(finalUri)) {
                                    fail("ECHO перенаправила на неподдерживаемый адрес: " + finalUri.host)
                                    return
                                }
                                val script = """
                                    (function () {
                                      if (window.__echoAndroidBootstrapped) return;
                                      window.__echoAndroidBootstrapped = true;
                                      var musicVolume = $music, sfxVolume = $sfx;
                                      var language = '$language';
                                      try {
                                        localStorage.setItem('echo.music.volume', String(musicVolume));
                                        localStorage.setItem('echo.sfx.volume', String(sfxVolume));
                                        localStorage.setItem('echo.language', language);
                                      } catch (_) {}
                                      var doneAudio = false, doneLocale = false, checks = 0;
                                      var sync = setInterval(function () {
                                        if (!doneAudio && window.ECHOAudio) {
                                          window.ECHOAudio.setMusicVolume(musicVolume);
                                          window.ECHOAudio.setSfxVolume(sfxVolume);
                                          doneAudio = true;
                                        }
                                        if (!doneLocale && window.ECHOI18n) {
                                          window.ECHOI18n.setLanguage(language);
                                          doneLocale = true;
                                        }
                                        if ((doneAudio && doneLocale) || ++checks > 30) clearInterval(sync);
                                      }, 150);
                                      if (!document.getElementById('echo-android-style')) {
                                        var style = document.createElement('style');
                                        style.id = 'echo-android-style';
                                        // Hide duplicate navigation without changing the site's flex heights,
                                        // margins, padding or scroll regions from main CSS.
                                        style.textContent = '#echo-fullscreen-toggle{display:none!important}' +
                                            '#game-exit,#character-back,#quests-back,#shop-back,#settings-back{' +
                                            'visibility:hidden!important;pointer-events:none!important}';
                                        document.head.appendChild(style);
                                      }
                                      var opener = '$opener', secondary = '$additional';
                                      if (opener) {
                                        var attempts = 0;
                                        var task = setInterval(function () {
                                          attempts++;
                                          var btn = document.getElementById(opener);
                                          if (btn && typeof window.ECHO_SELECTED_MODEL === 'string') {
                                            btn.click();
                                            clearInterval(task);
                                            if (secondary) setTimeout(function () {
                                              document.getElementById(secondary)?.click();
                                            }, 350);
                                          }
                                          if (attempts >= 25) clearInterval(task);
                                        }, 300);
                                      }
                                    })();
                                """.trimIndent()
                                view.evaluateJavascript(script, null)

                                // Don't treat "onPageFinished" as proof that JS/Three.js
                                // ran. Check the requested screen, not just HTML download.
                                val visibleTarget = when (page) {
                                    Page.ARENA ->
                                        "document.getElementById('world')?.width > 0 && document.getElementById('main-menu')?.classList.contains('is-hidden') === true"
                                    Page.HEROES, Page.HERO_VIEW ->
                                        "document.getElementById('menu-character')?.hidden === false"
                                    Page.SHOP, Page.PACK_VIEW ->
                                        "document.getElementById('menu-shop-screen')?.hidden === false"
                                    Page.QUESTS ->
                                        "document.getElementById('menu-quests-screen')?.hidden === false"
                                    else ->
                                        "document.getElementById('menu-settings-screen')?.hidden === false"
                                }
                                val check = "(function(){return document.readyState==='complete' " +
                                    "&& typeof window.ECHO_SELECTED_MODEL==='string' && (" +
                                    visibleTarget + ");})()"

                                fun probe(attempt: Int) {
                                    if (mainFrameBroken || !view.isAttachedToWindow) return
                                    view.evaluateJavascript(check) { result ->
                                        if (mainFrameBroken) return@evaluateJavascript
                                        if (result == "true") {
                                            loaded = true
                                            failed = false
                                            failureMessage = ""
                                            Log.d("EchoWebView", "ECHO ready: " + page)
                                        } else if (attempt < 45) {
                                            view.postDelayed({ probe(attempt + 1) }, 300)
                                        } else {
                                            fail("Страница ECHO открылась, но экран " +
                                                page + " не запустился. Проверь Logcat → EchoWebView. " +
                                                "Возможно, не загрузился JavaScript или WebGL.")
                                        }
                                    }
                                }
                                view.postDelayed({ probe(0) }, 300)
                            }
                        }
                        debugWebView.value = this
                        loadUrl(url)
                    }
                },
                onRelease = { view ->
                    debugWebView.value = null
                    // A crashed renderer may reject further load/stop operations.
                    runCatching { view.stopLoading() }
                    runCatching { view.loadUrl("about:blank") }
                    runCatching { view.destroy() }
                }
            )
        }

        if (!loaded && !failed) {
            Column(
                modifier = Modifier.align(Alignment.Center),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                CircularProgressIndicator(color = Accent)
                Text(
                    "Загрузка ECHO: " + progress + "%",
                    modifier = Modifier.padding(top = 12.dp),
                    fontSize = 12.sp, color = Muted
                )
            }
        }
        if (failed) {
            Column(
                modifier = Modifier.align(Alignment.Center)
                    .background(Panel, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text("Не удалось открыть ECHO", color = Accent, fontSize = 18.sp)
                Text(
                    if (failureMessage.isBlank()) "Проверь подключение и обнови Android System WebView."
                    else failureMessage,
                    color = Muted
                )
                Surface(
                    onClick = {
                        failed = false
                        loaded = false
                        retry++
                    },
                    color = Panel, contentColor = Accent,
                    border = BorderStroke(1.dp, Accent),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("ПОВТОРИТЬ", Modifier.padding(12.dp))
                }
                Surface(
                    onClick = {
                        runCatching {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(WEB_BASE)))
                        }
                    },
                    color = Panel, contentColor = Accent,
                    border = BorderStroke(1.dp, Color(0xFF596D7A)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("ПРОВЕРИТЬ САЙТ В БРАУЗЕРЕ", Modifier.padding(12.dp))
                }
            }
        }

        // An on-device diagnostics control is available in debug builds only.
        // It reports DOM/UI readiness without exposing account tokens or private data.
        if (isDebugBuild) {
            Surface(
                onClick = {
                    val script = """
                        (function(){
                            const ids=['menu-main','menu-character','menu-shop-screen',
                                'menu-quests-screen','menu-settings-screen'];
                            const screens=ids.filter(id=>{
                                const n=document.getElementById(id);
                                return n && !n.hidden;
                            });
                            return 'HTML: '+document.readyState
                                +'\nMenu: '+!!document.getElementById('main-menu')
                                +'\nJS: '+typeof window.ECHO_SELECTED_MODEL
                                +'\nScreen: '+screens.join(',')
                                +'\nSize: '+window.innerWidth+'x'+window.innerHeight;
                        })()
                    """.trimIndent()
                    debugWebView.value?.evaluateJavascript(script) { result ->
                        debugDetails = result.trim('"').replace("\\n", "\n")
                        showDebug = true
                    } ?: run {
                        debugDetails = "WebView instance unavailable"
                        showDebug = true
                    }
                },
                modifier = Modifier.align(Alignment.TopEnd)
                    .padding(top = 9.dp, end = 9.dp),
                color = Color.Black, contentColor = Accent,
                border = BorderStroke(1.dp, Color.White),
                shape = RoundedCornerShape(10.dp)
            ) {
                Text("?", Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
            }
        }
        if (showDebug) {
            AlertDialog(
                onDismissRequest = { showDebug = false },
                title = { Text("ECHO WebView") },
                text = {
                    Text(
                        "URL: " + url + "\nProgress: " + progress + "%" +
                            "\nLoaded: " + loaded +
                            "\nAndroid API: " + Build.VERSION.SDK_INT +
                            "\nWebView: " + (WebView.getCurrentWebViewPackage()?.versionName ?: "unknown") +
                            "\n" + debugDetails +
                            (if (lastConsoleError.isNotBlank())
                                "\nJS error: " + lastConsoleError else "")
                    )
                },
                confirmButton = {
                    TextButton(onClick = { showDebug = false }) { Text("ЗАКРЫТЬ") }
                },
                containerColor = Panel,
                titleContentColor = Accent,
                textContentColor = Accent
            )
        }

        Surface(
            onClick = { audio.click(); onBack() },
            modifier = if (page == Page.ARENA) {
                Modifier.align(Alignment.TopStart).padding(top = 10.dp, start = 10.dp)
                    .width(44.dp).height(44.dp)
            } else {
                Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp)
                    .width(nativeBackWidth).height(nativeBackHeight)
            },
            color = Color.Black,
            contentColor = Color.White,
            shape = RoundedCornerShape(13.dp),
            border = BorderStroke(1.dp, Color.White)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    when {
                        page == Page.ARENA -> "✕"
                        language == "en" -> "BACK"
                        else -> "НАЗАД"
                    },
                    fontFamily = FontFamily(Font(R.font.echo_superxp)),
                    fontSize = if (page == Page.ARENA) 22.sp else nativeBackFontSp.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}
