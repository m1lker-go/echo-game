package ru.echo.game

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import android.content.Intent
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.unit.em
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
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
internal fun EchoAndroidShell(
    audio: EchoAudioEngine,
    auth: EchoAuthSession,
    onVkLogin: () -> Unit,
    onLogout: () -> Unit
) {
    var page by remember { mutableStateOf(Page.HOME) }
    val context = LocalContext.current
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
                EchoNativePage(page, audio, auth, onVkLogin, onLogout,
                    onNavigate = { page = it }, onBack = back)
            else -> {
                // Avoid embedding WebGL inside Compose AndroidView on MIUI:
                // dedicate the Activity's native Android view hierarchy to it.
                LaunchedEffect(page) {
                    val destination = page
                    context.startActivity(
                        Intent(context, EchoWebActivity::class.java)
                            .putExtra(EchoWebActivity.EXTRA_PAGE, destination.name)
                    )
                    page = when (destination) {
                        Page.CODE_VIEW, Page.ACCOUNT -> Page.SETTINGS
                        else -> Page.HOME
                    }
                }
            }
        }
    }
}

private data class EchoParticle(
    val x: Float, val y: Float, val size: Float, val phase: Float,
    val speed: Float, val drift: Float
)

@Composable
private fun EchoSpaceBackground(
    backgroundColor: Color = Black,
    content: @Composable () -> Unit
) {
    // Identical motion model to client/menu.js in main:
    // x += sin(time * speed + phase) * 28 px;
    // y += cos(time * drift + phase) * 22 px;
    // particles have independent randomized position, phase and speeds.
    val particles = remember {
        val random = Random.Default
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
    var clock by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        val start = withFrameNanos { it }
        while (true) {
            withFrameNanos { now ->
                // Continuous animation clock (no jumping back to zero after 2 minutes).
                clock = (now - start) / 1_000_000f
            }
        }
    }
    Box(Modifier.fillMaxSize().background(backgroundColor)) {
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
    weight: FontWeight = FontWeight.Normal,
    letterSpacingEm: Float = 0f
) {
    Text(
        text = text, color = color, modifier = modifier,
        fontFamily = EchoFont, fontWeight = weight,
        fontSize = size.sp, lineHeight = (size * 1.18f).sp,
        textAlign = if (centered) TextAlign.Center else TextAlign.Start,
        letterSpacing = letterSpacingEm.em,
        maxLines = 2, overflow = TextOverflow.Ellipsis
    )
}

@Composable
private fun EchoButton(
    text: String,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    height: androidx.compose.ui.unit.Dp = 48.dp,
    fontSize: Int = 19,
    flag: Int? = null,
    onClick: () -> Unit
) {
    val audio = LocalEchoAudio.current
    val shape = RoundedCornerShape(13.dp)
    Box(
        modifier = modifier.height(height)
            .clip(shape)
            .background(if (selected) White else Black)
            .border(1.dp, White, shape)
            .clickable { audio?.click(); onClick() },
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
            modifier = Modifier.padding(horizontal = 8.dp)
        ) {
            if (flag != null) {
                Image(
                    painter = painterResource(flag), contentDescription = null,
                    modifier = Modifier.width(28.dp).height(20.dp),
                    contentScale = ContentScale.Crop
                )
                Spacer(Modifier.width(9.dp))
            }
            EchoText(
                text, fontSize, if (selected) Black else White,
                centered = true, weight = FontWeight.Medium
            )
        }
    }
}

@Composable
private fun EchoNativePage(
    page: Page, audio: EchoAudioEngine,
    auth: EchoAuthSession, onVkLogin: () -> Unit, onLogout: () -> Unit,
    onNavigate: (Page) -> Unit, onBack: () -> Unit
) {
    EchoSpaceBackground {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // Capture the BoxWithConstraints dimensions before entering the
            // ColumnScope, which hides the implicit constraints receiver.
            val viewportHeight = maxHeight
            val css = EchoCss(viewportHeight)
            val width = css.contentWidth(maxWidth)

            // A viewport-wide scroll container receives gestures even at the
            // empty left/right edges. The visible content remains CSS-width.
            // Previously only the central narrow Column was scrollable.
            val scroll = rememberScrollState()
            Column(
                modifier = Modifier.fillMaxSize().verticalScroll(scroll),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Top
            ) {
                if (page == Page.HOME) {
                    val logoSize = css.logoFontSp
                    val gap = css.mainButtonsGap
                    val logoGap = css.mainLogoGap
                    val heightLeft = viewportHeight.value - 32f -
                        (logoSize * 1.22f) - logoGap.value - 4f * gap.value
                    val buttonHeight = (heightLeft / 5f).coerceAtLeast(34f).dp
                    Column(
                        modifier = Modifier.width(width).padding(vertical = 16.dp),
                        verticalArrangement = Arrangement.Top,
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "ЭХО.",
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center,
                            color = White,
                            style = TextStyle(
                                fontFamily = EchoFont,
                                fontSize = logoSize.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.38.em,
                                shadow = Shadow(
                                    color = Color(0x29EBF6FF),
                                    offset = Offset.Zero,
                                    blurRadius = 24f
                                )
                            ),
                            maxLines = 1
                        )
                        Spacer(Modifier.height(logoGap))
                        EchoButton(tr(audio, "НАЧАТЬ ИГРУ", "START GAME"), Modifier.fillMaxWidth(),
                            height = buttonHeight, fontSize = css.menuFontSp) {
                            onNavigate(Page.ARENA)
                        }
                        Spacer(Modifier.height(gap))
                        EchoButton(tr(audio, "ПЕРСОНАЖ", "CHARACTER"), Modifier.fillMaxWidth(),
                            height = buttonHeight, fontSize = css.menuFontSp) {
                            onNavigate(Page.HEROES)
                        }
                        Spacer(Modifier.height(gap))
                        EchoButton(tr(audio, "МАГАЗИН", "SHOP"), Modifier.fillMaxWidth(),
                            height = buttonHeight, fontSize = css.menuFontSp) {
                            onNavigate(Page.SHOP)
                        }
                        Spacer(Modifier.height(gap))
                        EchoButton(tr(audio, "ЗАДАНИЯ", "QUESTS"), Modifier.fillMaxWidth(),
                            height = buttonHeight, fontSize = css.menuFontSp) {
                            onNavigate(Page.QUESTS)
                        }
                        Spacer(Modifier.height(gap))
                        EchoButton(tr(audio, "НАСТРОЙКИ", "SETTINGS"), Modifier.fillMaxWidth(),
                            height = buttonHeight, fontSize = css.menuFontSp) {
                            onNavigate(Page.SETTINGS)
                        }
                    }
                } else {
                    Column(
                        modifier = Modifier.width(width).padding(top = 16.dp, bottom = 9.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = tr(audio, "НАСТРОЙКИ", "SETTINGS"),
                            color = White,
                            fontFamily = EchoFont,
                            fontSize = css.settingsTitleSp.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = 0.16.em,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(Modifier.height(10.dp))
                        EchoSettings(css, audio, auth, onVkLogin, onLogout, onNavigate)
                    }
                }
            }

            // main/client/fullscreen.css: fixed square upper-right return arrow.
            // Keep it outside the scroll container, so it never scrolls away.
            if (page == Page.SETTINGS) {
                AndroidView(
                    modifier = Modifier.align(Alignment.TopEnd)
                        .padding(
                            top = css.navigationTop,
                            end = css.navigationRight(maxWidth)
                        )
                        .size(css.navigationSize(maxWidth)),
                    factory = { ctx ->
                        EchoNavButton(ctx, EchoNavButton.Mode.BACK).apply {
                            setOnClickListener { audio.click(); onBack() }
                        }
                    },
                    update = { button ->
                        button.setOnClickListener { audio.click(); onBack() }
                    }
                )
            }
        }
    }
}

@Composable
private fun EchoSettings(
    css: EchoCss, audio: EchoAudioEngine, auth: EchoAuthSession,
    onVkLogin: () -> Unit, onLogout: () -> Unit,
    onNavigate: (Page) -> Unit
) {
    var confirmCache by remember { mutableStateOf(false) }
    var cacheMessage by remember { mutableStateOf("") }
    val context = LocalContext.current
    val english = audio.language == "en"
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(9.dp)
    ) {
        // Reflects main's Settings hierarchy: headers are LEFT aligned;
        // action buttons have equal width/height and stretch across content column.
        EchoText(tr(audio, "АККАУНТ", "ACCOUNT"), css.settingsLabelFontSp, Secondary,
            Modifier.fillMaxWidth(), letterSpacingEm = .12f)
        if (auth.nickname == null) {
            EchoButton(
                if (auth.busy) tr(audio, "ПОДКЛЮЧАЕМ VK...", "CONNECTING VK...")
                else tr(audio, "ВОЙТИ ЧЕРЕЗ VK", "SIGN IN WITH VK"),
                Modifier.fillMaxWidth(),
                height = css.settingsButtonHeight, fontSize = css.settingsButtonFontSp
            ) {
                if (!auth.busy) onVkLogin()
            }
        } else {
            EchoText(auth.nickname ?: "", css.settingsValueFontSp, White,
                Modifier.fillMaxWidth(), centered = true)
            EchoButton(tr(audio, "ВЫЙТИ ИЗ АККАУНТА", "SIGN OUT"), Modifier.fillMaxWidth(),
                height = css.settingsButtonHeight, fontSize = css.settingsButtonFontSp) {
                onLogout()
            }
        }
        if (auth.message != null) {
            EchoText(auth.message ?: "", css.settingsNoteFontSp, Secondary,
                Modifier.fillMaxWidth(), centered = true)
        }
        Spacer(Modifier.height(6.dp))
        EchoText(tr(audio, "ЯЗЫК", "LANGUAGE"), css.settingsLabelFontSp, Secondary,
            Modifier.fillMaxWidth(), letterSpacingEm = .12f)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            EchoButton(tr(audio, "РУССКИЙ", "RUSSIAN"), Modifier.weight(1f),
                selected = !english, height = css.settingsButtonHeight,
                fontSize = css.settingsButtonFontSp, flag = R.drawable.echo_flag_ru) {
                audio.updateLanguage("ru")
            }
            EchoButton("ENGLISH", Modifier.weight(1f),
                selected = english, height = css.settingsButtonHeight,
                fontSize = css.settingsButtonFontSp, flag = R.drawable.echo_flag_en) {
                audio.updateLanguage("en")
            }
        }
        Spacer(Modifier.height(6.dp))
        EchoText(tr(audio, "ЗВУК", "SOUND"), css.settingsLabelFontSp, Secondary,
            Modifier.fillMaxWidth(), letterSpacingEm = .12f)
        EchoVolumeSlider(tr(audio, "МУЗЫКА", "MUSIC"), audio.musicVolume,
            css.settingsValueFontSp, audio::updateMusicVolume)
        EchoVolumeSlider(tr(audio, "ЗВУКИ", "EFFECTS"), audio.sfxVolume,
            css.settingsValueFontSp, audio::updateSfxVolume)
        Spacer(Modifier.height(6.dp))
        EchoText(tr(audio, "ДРУГОЕ", "OTHER"), css.settingsLabelFontSp, Secondary,
            Modifier.fillMaxWidth(), letterSpacingEm = .12f)
        EchoButton(tr(audio, "ВВЕСТИ КОД", "REDEEM CODE"), Modifier.fillMaxWidth(),
            height = css.settingsButtonHeight, fontSize = css.settingsButtonFontSp) {
            onNavigate(Page.CODE_VIEW)
        }
        EchoButton(tr(audio, "ОЧИСТИТЬ КЭШ ИГРЫ", "CLEAR GAME CACHE"), Modifier.fillMaxWidth(),
            height = css.settingsButtonHeight, fontSize = css.settingsButtonFontSp) {
            confirmCache = true
        }
        EchoText(
            tr(audio, "Перезагрузит ECHO и запросит свежие файлы. Профиль и выбранный персонаж сохранятся.",
                "Reloads ECHO files. Profile and selected character are preserved."),
            css.settingsNoteFontSp, Secondary, Modifier.fillMaxWidth(), centered = true
        )
        if (cacheMessage.isNotEmpty()) {
            EchoText(cacheMessage, 12, Secondary, Modifier.fillMaxWidth(), centered = true)
        }
    }

    if (confirmCache) {
        EchoCacheConfirmDialog(
            audio = audio,
            onDismiss = { confirmCache = false },
            onConfirm = {
                confirmCache = false
                // Same intended behavior as the browser cache reset:
                // drop downloaded WebView resources without touching cookies,
                // WebStorage/localStorage, native account or user preferences.
                runCatching {
                    android.webkit.WebView(context).apply {
                        clearCache(true)
                        destroy()
                    }
                    cacheMessage = tr(audio, "Кэш очищен", "Cache cleared")
                }.onFailure {
                    cacheMessage = tr(audio, "Не удалось очистить кэш", "Could not clear cache")
                }
            }
        )
    }
}

/**
 * Compose counterpart of main/client/style.css .echo-modal-overlay/.echo-modal
 * and client/cache-reset.js ECHOModal.confirm.
 *
 * The dialog is native, so it appears immediately in Android Settings and
 * never launches the website's main menu just to ask for confirmation.
 */
@Composable
private fun EchoCacheConfirmDialog(
    audio: EchoAudioEngine,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            dismissOnClickOutside = false,
            dismissOnBackPress = true,
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false
        )
    ) {
        // Browser: rgba(0,0,0,.82), 46 animated ice-blue particles.
        EchoSpaceBackground(backgroundColor = Color(0xD1000000)) {
            BoxWithConstraints(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                contentAlignment = Alignment.Center
            ) {
                val availableWidth = maxWidth
                val availableHeight = maxHeight
                val compact = availableHeight <= 520.dp
                val panelShape = RoundedCornerShape(13.dp)
                val panelPadding = if (compact) 22.dp else 42.dp
                Column(
                    modifier = Modifier
                        .width(minOf(availableWidth, 680.dp))
                        .heightIn(max = availableHeight)
                        .clip(panelShape)
                        .background(Color.Black)
                        .border(1.dp, Color.White, panelShape)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = panelPadding, vertical = if (compact) 24.dp else 34.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = tr(audio, "СБРОС КЭША", "CLEAR CACHE"),
                        modifier = Modifier.fillMaxWidth(),
                        color = Color.White,
                        fontFamily = FontFamily.SansSerif,
                        fontSize = if (availableWidth < 600.dp) 22.sp else 28.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 0.14.em,
                        textAlign = TextAlign.Center,
                        lineHeight = 36.sp
                    )
                    Spacer(Modifier.height(if (compact) 18.dp else 30.dp))
                    Text(
                        text = tr(
                            audio,
                            "Вы уверены, что хотите сбросить кэш?",
                            "Are you sure you want to clear the cache?"
                        ),
                        modifier = Modifier.fillMaxWidth(),
                        color = Color.White,
                        fontFamily = FontFamily.SansSerif,
                        fontSize = 14.sp,
                        lineHeight = 24.sp,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(if (compact) 20.dp else 36.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        EchoModalAction(
                            label = tr(audio, "НЕТ", "NO"),
                            primary = false,
                            modifier = Modifier.weight(1f)
                        ) {
                            audio.click()
                            onDismiss()
                        }
                        EchoModalAction(
                            label = tr(audio, "ДА", "YES"),
                            primary = true,
                            modifier = Modifier.weight(1f)
                        ) {
                            audio.click()
                            onConfirm()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EchoModalAction(
    label: String, primary: Boolean, modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val shape = RoundedCornerShape(13.dp)
    Box(
        modifier = modifier.height(48.dp)
            .clip(shape)
            .background(if (primary) Color.White else Color.Black)
            .border(1.dp, Color.White, shape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            label,
            color = if (primary) Color.Black else Color.White,
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 12.sp,
            letterSpacing = 0.1.em,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun EchoVolumeSlider(label: String, value: Float, fontSize: Int, onChange: (Float) -> Unit) {
    Column(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Black)
            .border(1.dp, White, RoundedCornerShape(12.dp))
            .padding(horizontal = 16.dp, vertical = 9.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            EchoText(label, fontSize)
            EchoText((value * 100f).toInt().toString() + "%", fontSize)
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
