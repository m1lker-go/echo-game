package ru.echo.game

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

private val EchoFont = FontFamily(Font(R.font.echo_superxp))
private val White = Color(0xFFF1F4F7)
private val Secondary = Color(0xFF909AA7)
private val Black = Color.Black
private val Cyan = Color(0xFFB6EBFF)
private val Border = Color(0xFF4A5967)
private val LocalEchoAudio = staticCompositionLocalOf<EchoAudioEngine?> { null }

private fun tr(audio: EchoAudioEngine, ru: String, en: String) =
    if (audio.language == "en") en else ru

/**
 * Current playable hybrid:
 * - Android Home + Settings;
 * - the original, working ECHO web screens for Arena, Heroes, Shop and Quests.
 * Do not show unconnected native collection/quest/payment placeholders.
 */
@Composable
internal fun EchoAndroidShell(audio: EchoAudioEngine) {
    var page by remember { mutableStateOf(Page.HOME) }
    LaunchedEffect(page) {
        audio.setWebActive(page != Page.HOME && page != Page.SETTINGS)
    }
    val back: () -> Unit = {
        page = when (page) {
            Page.ACCOUNT, Page.CODE_VIEW -> Page.SETTINGS
            else -> Page.HOME
        }
    }
    CompositionLocalProvider(LocalEchoAudio provides audio) {
        BackHandler(enabled = page != Page.HOME, onBack = back)
        when (page) {
            Page.HOME, Page.SETTINGS ->
                EchoNativePage(page, audio, onNavigate = { page = it }, onBack = back)
            else -> WebPage(page, back, audio)
        }
    }
}

private data class EchoParticle(
    val x: Float, val y: Float, val size: Float, val phase: Float,
    val speed: Float, val drift: Float
)

@Composable
private fun EchoSpaceBackground(content: @Composable () -> Unit) {
    // Identical motion model to client/menu.js in main:
    // x += sin(time * speed + phase) * 28 px;
    // y += cos(time * drift + phase) * 22 px;
    // particles have independent randomized position, phase and speeds.
    val particles = remember {
        val random = Random(82141)
        List(46) {
            EchoParticle(
                x = random.nextFloat(), y = random.nextFloat(),
                size = 1.8f + random.nextFloat() * 2.6f,
                phase = random.nextFloat() * (2f * Math.PI.toFloat()),
                speed = 0.00008f + random.nextFloat() * 0.00012f,
                drift = 0.00015f + random.nextFloat() * 0.00025f
            )
        }
    }
    val transition = rememberInfiniteTransition(label = "echo-moving-particles")
    val clock by transition.animateFloat(
        initialValue = 0f, targetValue = 120000f,
        animationSpec = infiniteRepeatable(tween(120000, easing = LinearEasing)),
        label = "time-ms"
    )
    Box(Modifier.fillMaxSize().background(Black)) {
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height
            val unit = density
            for (particle in particles) {
                // Original values are CSS pixels: convert to actual Android px.
                val x = ((particle.x * w +
                    sin(clock * particle.speed + particle.phase) * 28f * unit + w) % w)
                val y = ((particle.y * h +
                    cos(clock * particle.drift + particle.phase) * 22f * unit + h) % h)
                val pulse = .55f + .45f * sin(clock * .0022f + particle.phase)
                val radius = particle.size * pulse * unit
                val center = Offset(x, y)
                drawCircle(
                    brush = Brush.radialGradient(
                        0f to Color(0xFFDDF2FF).copy(alpha = .38f),
                        .30f to Color(0xFFDDF2FF).copy(alpha = .14f),
                        1f to Color.Transparent,
                        center = center,
                        radius = radius * 4.2f
                    ),
                    radius = radius * 4.2f, center = center
                )
                drawCircle(
                    color = Color(0xFFEBF8FF).copy(alpha = .28f + pulse * .42f),
                    radius = radius, center = center
                )
            }
        }
        content()
    }
}

@Composable
private fun EchoText(
    text: String,
    size: Int = 17,
    color: Color = White,
    modifier: Modifier = Modifier,
    centered: Boolean = false,
    weight: FontWeight = FontWeight.Normal
) {
    Text(
        text = text, color = color, modifier = modifier,
        fontFamily = EchoFont, fontWeight = weight,
        fontSize = size.sp, lineHeight = (size * 1.18f).sp,
        textAlign = if (centered) TextAlign.Center else TextAlign.Start,
        maxLines = 2, overflow = TextOverflow.Ellipsis
    )
}

@Composable
private fun EchoButton(
    text: String,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    height: androidx.compose.ui.unit.Dp = 48.dp,
    onClick: () -> Unit
) {
    val audio = LocalEchoAudio.current
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier = modifier.height(height)
            .clip(shape)
            .background(if (selected) White else Black)
            .border(1.dp, White, shape)
            .clickable { audio?.click(); onClick() },
        contentAlignment = Alignment.Center
    ) {
        EchoText(
            text, 19, if (selected) Black else White,
            modifier = Modifier.padding(horizontal = 8.dp),
            centered = true, weight = FontWeight.Medium
        )
    }
}

@Composable
private fun EchoNativePage(
    page: Page, audio: EchoAudioEngine,
    onNavigate: (Page) -> Unit, onBack: () -> Unit
) {
    EchoSpaceBackground {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // Matches client/menu-width.css: page content ≈ viewport height.
            val contentWidth = minOf(maxHeight, maxWidth - 36.dp)
            if (page == Page.HOME) {
                Column(
                    Modifier.align(Alignment.Center).width(contentWidth)
                        .fillMaxHeight().verticalScroll(rememberScrollState())
                        .padding(vertical = 8.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    EchoText("ЭХО.", 52, modifier = Modifier.fillMaxWidth(), centered = true,
                        weight = FontWeight.Bold)
                    Spacer(Modifier.height(17.dp))
                    EchoButton(tr(audio, "НАЧАТЬ ИГРУ", "START GAME"), Modifier.fillMaxWidth()) {
                        onNavigate(Page.ARENA)
                    }
                    Spacer(Modifier.height(8.dp))
                    EchoButton(tr(audio, "ПЕРСОНАЖ", "CHARACTER"), Modifier.fillMaxWidth()) {
                        onNavigate(Page.HEROES)
                    }
                    Spacer(Modifier.height(8.dp))
                    EchoButton(tr(audio, "МАГАЗИН", "SHOP"), Modifier.fillMaxWidth()) {
                        onNavigate(Page.SHOP)
                    }
                    Spacer(Modifier.height(8.dp))
                    EchoButton(tr(audio, "ЗАДАНИЯ", "QUESTS"), Modifier.fillMaxWidth()) {
                        onNavigate(Page.QUESTS)
                    }
                    Spacer(Modifier.height(8.dp))
                    EchoButton(tr(audio, "НАСТРОЙКИ", "SETTINGS"), Modifier.fillMaxWidth()) {
                        onNavigate(Page.SETTINGS)
                    }
                }
            } else {
                Column(
                    Modifier.align(Alignment.Center).width(contentWidth)
                        .fillMaxHeight().padding(vertical = 9.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    EchoText(tr(audio, "НАСТРОЙКИ", "SETTINGS"), 27, modifier = Modifier.fillMaxWidth(),
                        centered = true, weight = FontWeight.SemiBold)
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        EchoSettings(audio, onNavigate)
                    }
                    Spacer(Modifier.height(7.dp))
                    EchoButton(tr(audio, "НАЗАД", "BACK"), Modifier.fillMaxWidth(), height = 44.dp, onClick = onBack)
                }
            }
        }
    }
}

@Composable
private fun EchoSettings(audio: EchoAudioEngine, onNavigate: (Page) -> Unit) {
    var confirmCache by remember { mutableStateOf(false) }
    var cacheMessage by remember { mutableStateOf("") }
    val context = LocalContext.current
    val english = audio.language == "en"
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        EchoText(tr(audio, "АККАУНТ", "ACCOUNT"), 17, Secondary, Modifier.fillMaxWidth(), centered = true)
        EchoButton(tr(audio, "ВОЙТИ В АККАУНТ", "SIGN IN"), Modifier.fillMaxWidth(), height = 42.dp) {
            onNavigate(Page.ACCOUNT)
        }
        EchoText(tr(audio, "ЯЗЫК", "LANGUAGE"), 17, Secondary, Modifier.fillMaxWidth(), centered = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            EchoButton(tr(audio, "РУССКИЙ", "RUSSIAN"), Modifier.weight(1f), selected = !english, height = 42.dp) {
                audio.updateLanguage("ru")
            }
            EchoButton("ENGLISH", Modifier.weight(1f), selected = english, height = 42.dp) {
                audio.updateLanguage("en")
            }
        }
        EchoText(tr(audio, "ЗВУК", "SOUND"), 17, Secondary, Modifier.fillMaxWidth(), centered = true)
        EchoVolumeSlider(tr(audio, "МУЗЫКА", "MUSIC"), audio.musicVolume, audio::updateMusicVolume)
        EchoVolumeSlider(tr(audio, "ЗВУКИ", "EFFECTS"), audio.sfxVolume, audio::updateSfxVolume)
        EchoText(tr(audio, "ДРУГОЕ", "OTHER"), 17, Secondary, Modifier.fillMaxWidth(), centered = true)
        EchoButton(tr(audio, "ВВЕСТИ КОД", "REDEEM CODE"), Modifier.fillMaxWidth(), height = 42.dp) {
            onNavigate(Page.CODE_VIEW)
        }
        EchoButton(tr(audio, "ОЧИСТИТЬ КЭШ ИГРЫ", "CLEAR GAME CACHE"), Modifier.fillMaxWidth(), height = 42.dp) {
            confirmCache = true
        }
        if (cacheMessage.isNotEmpty()) {
            EchoText(cacheMessage, 12, Secondary, Modifier.fillMaxWidth(), centered = true)
        }
    }
    if (confirmCache) {
        AlertDialog(
            onDismissRequest = { confirmCache = false },
            title = { EchoText(tr(audio, "СБРОС КЭША", "CLEAR CACHE"), 22) },
            text = { EchoText(tr(audio, "Удалить временные файлы WebView? Вход и настройки сохранятся.", "Remove temporary WebView files? Login and settings remain."), 16) },
            confirmButton = {
                TextButton(onClick = {
                    confirmCache = false
                    runCatching {
                        android.webkit.WebView(context).apply {
                            clearCache(true)
                            destroy()
                        }
                        cacheMessage = tr(audio, "Кэш очищен", "Cache cleared")
                    }.onFailure {
                        cacheMessage = tr(audio, "Не удалось очистить кэш", "Could not clear cache")
                    }
                }) { EchoText(tr(audio, "ДА", "YES"), 18) }
            },
            dismissButton = {
                TextButton(onClick = { confirmCache = false }) {
                    EchoText(tr(audio, "НЕТ", "NO"), 18)
                }
            },
            containerColor = Color(0xFF111820)
        )
    }
}

@Composable
private fun EchoVolumeSlider(label: String, value: Float, onChange: (Float) -> Unit) {
    Column(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Black)
            .border(1.dp, Border, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 5.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            EchoText(label, 17)
            EchoText((value * 100f).toInt().toString() + "%", 16)
        }
        Slider(
            value = value, onValueChange = onChange, valueRange = 0f..1f,
            modifier = Modifier.fillMaxWidth().height(35.dp),
            colors = SliderDefaults.colors(
                thumbColor = Cyan, activeTrackColor = Cyan,
                inactiveTrackColor = Color(0xFF30404C)
            )
        )
    }
}
