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
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

private const val WEB_BASE = "https://cat-fight.ru/echo/"
private val Background = Color(0xFF05090F)
private val Panel = Color(0xFF111D29)
private val Accent = Color(0xFF90E5FF)
private val Muted = Color(0xFF96A8B7)

private enum class Page {
    HOME, HEROES, SHOP, QUESTS, ACCOUNT, SETTINGS,
    ARENA, HERO_VIEW, PACK_VIEW
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        setContent { MaterialTheme { EchoApplication() } }
    }
}

@Composable
private fun EchoApplication() {
    var page by remember { mutableStateOf(Page.HOME) }
    val back = {
        page = when (page) {
            Page.HERO_VIEW -> Page.HEROES
            Page.PACK_VIEW -> Page.SHOP
            else -> Page.HOME
        }
    }
    BackHandler(enabled = page != Page.HOME, onBack = back)

    when (page) {
        Page.HOME -> HomePage { page = it }
        Page.HEROES -> ContentPage(
            title = "ГЕРОИ",
            subtitle = "Коллекция персонажей ECHO",
            onBack = back
        ) {
            Text(
                "Галерея персонажей уже работает на Three.js. Пока откроем её в WebView; позже здесь появится нативный список героев с прогрессом коллекции.",
                color = Muted
            )
            Spacer(Modifier.height(18.dp))
            Action("ОТКРЫТЬ 3D-ГАЛЕРЕЮ", true, Modifier.fillMaxWidth()) {
                page = Page.HERO_VIEW
            }
        }
        Page.SHOP -> ContentPage(
            title = "МАГАЗИН",
            subtitle = "Паки, карточки и коллекция",
            onBack = back
        ) {
            Text(
                "Нативная витрина и Android-платежи будут подключены отдельно. В первой сборке доступен просмотр существующей веб-витрины и анимаций.",
                color = Muted
            )
            Spacer(Modifier.height(18.dp))
            Action("ПОСМОТРЕТЬ ПАКИ", true, Modifier.fillMaxWidth()) {
                page = Page.PACK_VIEW
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "Платные покупки в Android пока не подключены.",
                fontSize = 13.sp,
                color = Muted
            )
        }
        Page.QUESTS -> ContentPage(
            title = "ЗАДАНИЯ",
            subtitle = "Ежедневные и особые испытания",
            onBack = back
        ) {
            Text(
                "Этот экран подготовлен для нативной версии заданий. Следующим этапом подключим текущие задания и получение наград через серверный API ECHO.",
                color = Muted
            )
        }
        Page.ACCOUNT -> ContentPage(
            title = "ПРОФИЛЬ",
            subtitle = "Игровая учётная запись",
            onBack = back
        ) {
            Text(
                "В этой тестовой сборке доступна гостевая игра. Вход VK ID и синхронизацию профиля с Android добавим отдельным этапом.",
                color = Muted
            )
            Spacer(Modifier.height(12.dp))
            Text(
                "Прогресс зарегистрированного аккаунта не переносится автоматически из VK Mini Apps.",
                color = Muted,
                fontSize = 13.sp
            )
        }
        Page.SETTINGS -> ContentPage(
            title = "НАСТРОЙКИ",
            subtitle = "ECHO для Android · первая сборка",
            onBack = back
        ) {
            Text("Ориентация: горизонтальная", color = Color.White)
            Spacer(Modifier.height(12.dp))
            Text("Экран: полноэкранный режим Android", color = Color.White)
            Spacer(Modifier.height(12.dp))
            Text("Музыка и звук настраиваются в существующем игровом интерфейсе.", color = Muted)
            Spacer(Modifier.height(20.dp))
            Text("Версия APK: 0.1.0 · тестовый выпуск", color = Muted, fontSize = 13.sp)
        }
        Page.ARENA, Page.HERO_VIEW, Page.PACK_VIEW -> WebPage(
            page = page,
            onBack = back
        )
    }
}

@Composable
private fun Backdrop(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF0B2634), Background, Color(0xFF050608))
                )
            )
    ) {
        content()
    }
}

@Composable
private fun HomePage(onNavigate: (Page) -> Unit) {
    Backdrop {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 34.dp, vertical = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(26.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(
                modifier = Modifier.weight(0.98f).fillMaxHeight(),
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    "ECHO.",
                    color = Color.White,
                    fontSize = 59.sp,
                    fontWeight = FontWeight.Black,
                    letterSpacing = 5.sp
                )
                Text("ЗА ПРЕДЕЛАМИ ТИШИНЫ", color = Accent, fontSize = 12.sp, letterSpacing = 3.sp)
                Spacer(Modifier.height(20.dp))
                Text(
                    "Собирай энергию. Побеждай соперников. Открывай новых героев.",
                    color = Muted,
                    fontSize = 16.sp,
                    lineHeight = 23.sp
                )
                Spacer(Modifier.height(26.dp))
                Text(
                    "ANDROID · ТЕСТОВАЯ ВЕРСИЯ",
                    color = Color(0xFF668296),
                    fontSize = 11.sp,
                    letterSpacing = 2.sp
                )
            }

            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically)
            ) {
                Action("▶  ИГРАТЬ", true, Modifier.fillMaxWidth()) {
                    onNavigate(Page.ARENA)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Action("ГЕРОИ", modifier = Modifier.weight(1f)) { onNavigate(Page.HEROES) }
                    Action("МАГАЗИН", modifier = Modifier.weight(1f)) { onNavigate(Page.SHOP) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Action("ЗАДАНИЯ", modifier = Modifier.weight(1f)) { onNavigate(Page.QUESTS) }
                    Action("ПРОФИЛЬ", modifier = Modifier.weight(1f)) { onNavigate(Page.ACCOUNT) }
                }
                Action("НАСТРОЙКИ", modifier = Modifier.fillMaxWidth()) {
                    onNavigate(Page.SETTINGS)
                }
            }
        }
    }
}

@Composable
private fun Action(
    title: String,
    primary: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(51.dp),
        color = if (primary) Accent else Panel,
        contentColor = if (primary) Background else Color.White,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, if (primary) Accent else Color(0xFF365063))
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 8.dp)) {
            Text(
                title,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                letterSpacing = 1.sp,
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
private fun ContentPage(
    title: String,
    subtitle: String,
    onBack: () -> Unit,
    content: @Composable ColumnScope.() -> Unit
) {
    Backdrop {
        Row(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            Column(modifier = Modifier.width(240.dp).fillMaxHeight()) {
                Text(
                    "ECHO.",
                    color = Accent,
                    fontSize = 27.sp,
                    fontWeight = FontWeight.Black,
                    letterSpacing = 4.sp
                )
                Spacer(Modifier.height(18.dp))
                Text(title, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                Text(subtitle, color = Muted, fontSize = 14.sp)
                Spacer(Modifier.weight(1f))
                Action("← НАЗАД", modifier = Modifier.fillMaxWidth(), onClick = onBack)
            }
            Surface(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                shape = RoundedCornerShape(18.dp),
                color = Panel.copy(alpha = 0.82f),
                border = BorderStroke(1.dp, Color(0xFF354C5D))
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(24.dp),
                    verticalArrangement = Arrangement.Center,
                    content = content
                )
            }
        }
    }
}

@Composable
private fun WebPage(page: Page, onBack: () -> Unit) {
    val context = LocalContext.current
    var failed by remember(page) { mutableStateOf(false) }
    var loaded by remember(page) { mutableStateOf(false) }
    var retry by remember(page) { mutableIntStateOf(0) }
    val url = when (page) {
        Page.ARENA -> WEB_BASE + "?play=1&apk=1"
        else -> WEB_BASE + "?apk=1"
    }

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
                                view: WebView,
                                request: WebResourceRequest
                            ): Boolean {
                                val target = request.url
                                if (target.scheme == "https" &&
                                    target.host.equals("cat-fight.ru", ignoreCase = true) &&
                                    target.path.orEmpty().startsWith("/echo/")
                                ) {
                                    return false
                                }
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
                                if (url.startsWith(WEB_BASE)) {
                                    loaded = true
                                    val opener = when (page) {
                                        Page.HERO_VIEW -> "menu-character-button"
                                        Page.PACK_VIEW -> "menu-shop"
                                        else -> ""
                                    }
                                    // Compatibility mode: open existing Web gallery/shop.
                                    // Standalone viewer pages will replace this temporary click.
                                    val script = """
                                        (function () {
                                          if (!document.getElementById('echo-android-style')) {
                                            var style = document.createElement('style');
                                            style.id = 'echo-android-style';
                                            style.textContent = '#echo-fullscreen-toggle,#game-exit{display:none!important}';
                                            document.head.appendChild(style);
                                          }
                                          var menuButtonId = '$opener';
                                          if (menuButtonId) {
                                            var retries = 0;
                                            var interval = setInterval(function () {
                                              retries++;
                                              var btn = document.getElementById(menuButtonId);
                                              if (btn) { btn.click(); clearInterval(interval); }
                                              if (retries >= 25) clearInterval(interval);
                                            }, 300);
                                          }
                                        })();
                                    """.trimIndent()
                                    view.evaluateJavascript(script, null)
                                }
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
                modifier = Modifier
                    .align(Alignment.Center)
                    .background(Panel, RoundedCornerShape(18.dp))
                    .padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Нет подключения к ECHO", color = Color.White, fontSize = 19.sp)
                Text("Проверь интернет и повтори загрузку.", color = Muted)
                Action("ПОВТОРИТЬ", true, Modifier.width(220.dp)) {
                    failed = false
                    loaded = false
                    retry++
                }
            }
        }

        Surface(
            onClick = onBack,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp),
            color = Color(0xEA101820),
            contentColor = Color.White,
            shape = RoundedCornerShape(30.dp),
            border = BorderStroke(1.dp, Color(0xFF688293))
        ) {
            Text(
                "← В МЕНЮ ANDROID",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 9.dp),
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.sp
            )
        }
    }
}
