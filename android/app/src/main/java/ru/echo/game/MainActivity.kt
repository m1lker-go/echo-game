package ru.echo.game

import android.content.Intent
import android.graphics.Color as AndroidColor
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        echoAudio = EchoAudioEngine(applicationContext)
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
        setContent { MaterialTheme { EchoAndroidShell(echoAudio) } }
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
internal fun WebPage(page: Page, onBack: () -> Unit, audio: EchoAudioEngine) {
    val context = LocalContext.current
    var failed by remember(page) { mutableStateOf(false) }
    var loaded by remember(page) { mutableStateOf(false) }
    var retry by remember(page) { mutableIntStateOf(0) }
    val url = when (page) {
        Page.ARENA -> WEB_BASE + "?play=1&apk=1"
        else -> WEB_BASE + "?apk=1"
    }
    val opener = when (page) {
        Page.HERO_VIEW -> "menu-character-button"
        Page.PACK_VIEW -> "menu-shop"
        Page.ACCOUNT, Page.CODE_VIEW -> "menu-settings"
        else -> ""
    }
    val additional = if (page == Page.CODE_VIEW) "settings-enter-code" else ""
    val music = audio.musicVolume
    val sfx = audio.sfxVolume
    val language = audio.language

    Box(Modifier.fillMaxSize().background(Background)) {
        key(page, retry) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = {
                    WebView(context).apply {
                        setBackgroundColor(AndroidColor.BLACK)
                        setLayerType(View.LAYER_TYPE_HARDWARE, null)
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.setSupportZoom(false)
                        settings.javaScriptCanOpenWindowsAutomatically = false
                        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        settings.mediaPlaybackRequiresUserGesture = true
                        webChromeClient = WebChromeClient()
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(
                                view: WebView, request: WebResourceRequest
                            ): Boolean {
                                val target = request.url
                                if (target.scheme == "https" &&
                                    target.host.equals("cat-fight.ru", ignoreCase = true) &&
                                    target.path.orEmpty().startsWith("/echo/")
                                ) return false

                                if (request.isForMainFrame &&
                                    (target.scheme == "https" || target.scheme == "http")
                                ) {
                                    runCatching {
                                        context.startActivity(Intent(Intent.ACTION_VIEW, target))
                                    }
                                }
                                return true
                            }

                            override fun onPageFinished(view: WebView, url: String) {
                                super.onPageFinished(view, url)
                                if (!url.startsWith(WEB_BASE)) return
                                failed = false
                                loaded = true
                                // Only inject into the trusted ECHO website.
                                // Keep its existing game engine, authentication
                                // and all three original WebView animations.
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
                                        style.textContent = '#echo-fullscreen-toggle,#game-exit{display:none!important}';
                                        document.head.appendChild(style);
                                      }
                                      var opener = '$opener', secondary = '$additional';
                                      if (opener) {
                                        var attempts = 0;
                                        var task = setInterval(function () {
                                          attempts++;
                                          var btn = document.getElementById(opener);
                                          if (btn) {
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
                            }

                            override fun onReceivedError(
                                view: WebView,
                                request: WebResourceRequest,
                                error: WebResourceError
                            ) {
                                if (request.isForMainFrame) {
                                    failed = true
                                    loaded = false
                                }
                            }
                        }
                        loadUrl(url)
                    }
                },
                onRelease = { view ->
                    view.stopLoading()
                    view.loadUrl("about:blank")
                    view.destroy()
                }
            )
        }

        if (!loaded && !failed) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.Center),
                color = Accent
            )
        }
        if (failed) {
            Column(
                modifier = Modifier.align(Alignment.Center)
                    .background(Panel, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text("Нет подключения к ECHO", color = Accent, fontSize = 18.sp)
                Text("Проверь интернет и повтори загрузку.", color = Muted)
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
            }
        }

        Surface(
            onClick = { audio.click(); onBack() },
            modifier = Modifier.align(Alignment.TopStart).padding(top = 8.dp, start = 10.dp),
            color = Color(0xEA0C1016),
            contentColor = Color.White,
            shape = RoundedCornerShape(12.dp),
            border = BorderStroke(1.dp, Color(0xFF8795A3))
        ) {
            Text(
                if (language == "en") "← ANDROID MENU" else "← МЕНЮ ANDROID",
                modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp),
                fontSize = 12.sp, fontWeight = FontWeight.Bold
            )
        }
    }
}
