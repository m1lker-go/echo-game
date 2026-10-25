package ru.echo.game

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.text.BasicTextField
import android.content.Intent
import com.vk.id.OAuth
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Slider
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
private val EchoNicknamePattern = Regex("^[A-Za-zА-Яа-яЁё0-9_-]{3,20}$")
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
    onVkLogin: (OAuth) -> Unit,
    onLogout: () -> Unit,
    onDeleteAccount: () -> Unit,
    onChangeNickname: (String) -> Unit,
    onOAuthLogin: (String, Boolean) -> Unit
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
                EchoNativePage(page, audio, auth, onVkLogin, onLogout, onDeleteAccount, onChangeNickname, onOAuthLogin,
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
    auth: EchoAuthSession, onVkLogin: (OAuth) -> Unit, onLogout: () -> Unit,
    onDeleteAccount: () -> Unit, onChangeNickname: (String) -> Unit,
    onOAuthLogin: (String, Boolean) -> Unit,
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
                        EchoSettings(css, audio, auth, onVkLogin, onLogout, onDeleteAccount,
                            onChangeNickname, onOAuthLogin, onNavigate)
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
    onVkLogin: (OAuth) -> Unit, onLogout: () -> Unit,
    onDeleteAccount: () -> Unit, onChangeNickname: (String) -> Unit,
    onOAuthLogin: (String, Boolean) -> Unit,
    onNavigate: (Page) -> Unit
) {
    var confirmCache by remember { mutableStateOf(false) }
    var confirmLogout by remember { mutableStateOf(false) }
    var showAuthDialog by remember { mutableStateOf(false) }
    LaunchedEffect(auth.nickname) {
        if (auth.nickname != null) showAuthDialog = false
    }
    var confirmDelete by remember { mutableStateOf(false) }
    var nicknameEditor by remember { mutableStateOf(false) }
    var nicknameConfirmation by remember { mutableStateOf(false) }
    var nicknameDraft by remember { mutableStateOf("") }
    var nicknameError by remember { mutableStateOf(false) }
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
                if (auth.busy) tr(audio, "ВХОД...", "SIGNING IN...")
                else tr(audio, "ВОЙТИ В АККАУНТ", "SIGN IN"),
                Modifier.fillMaxWidth(),
                height = css.settingsButtonHeight, fontSize = css.settingsButtonFontSp
            ) {
                if (!auth.busy) showAuthDialog = true
            }
        } else {
            // Mirror the site's two equally sized account controls: a bordered
            // nickname/pencil capsule and a white logout button.
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val accountShape = RoundedCornerShape(12.dp)
                Row(
                    modifier = Modifier.weight(1f).height(css.settingsButtonHeight)
                        .clip(accountShape).background(Black).border(1.dp, White, accountShape),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    EchoText(
                        auth.nickname ?: "", css.settingsValueFontSp, White,
                        Modifier.weight(1f).padding(horizontal = 5.dp),
                        centered = true
                    )
                    Spacer(Modifier.width(1.dp).fillMaxHeight().background(White))
                    Box(
                        Modifier.width(css.settingsButtonHeight * .70f).fillMaxHeight()
                            .semantics {
                                contentDescription = tr(audio, "Изменить имя", "Edit nickname")
                            }
                            .clickable(enabled = !auth.busy) {
                                audio.click()
                                nicknameDraft = auth.nickname.orEmpty()
                                nicknameError = false
                                nicknameEditor = true
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        EchoSettingsIcon(isTrash = false)
                    }
                }
                EchoButton(
                    tr(audio, "ВЫЙТИ ИЗ АККАУНТА", "SIGN OUT"),
                    Modifier.weight(1f),
                    selected = true, height = css.settingsButtonHeight,
                    fontSize = css.settingsValueFontSp
                ) {
                    if (!auth.busy) confirmLogout = true
                }
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
        // Keep destructive account removal away from the profile controls:
        // a single square trash action at the LEFT of Clear Cache.
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (auth.nickname != null) {
                val trashShape = RoundedCornerShape(13.dp)
                Box(
                    modifier = Modifier.size(css.settingsButtonHeight)
                        .clip(trashShape).background(Black).border(1.dp, White, trashShape)
                        .semantics {
                            contentDescription = tr(audio, "Удалить аккаунт", "Delete account")
                        }
                        .clickable(enabled = !auth.busy) {
                            audio.click()
                            confirmDelete = true
                        },
                    contentAlignment = Alignment.Center
                ) {
                    EchoSettingsIcon(isTrash = true)
                }
            }
            EchoButton(
                tr(audio, "ОЧИСТИТЬ КЭШ ИГРЫ", "CLEAR GAME CACHE"),
                Modifier.weight(1f),
                height = css.settingsButtonHeight, fontSize = css.settingsButtonFontSp
            ) {
                confirmCache = true
            }
        }
        EchoText(
            tr(audio, "Перезагрузит ECHO и запросит свежие файлы. Профиль и выбранный персонаж сохранятся.",
                "Reloads ECHO files. Profile and selected character are preserved."),
            css.settingsNoteFontSp, Secondary, Modifier.fillMaxWidth(), centered = true
        )
        // Plain white link: the full row is tappable without button chrome.
        EchoText(
            tr(audio, "Политика конфиденциальности", "Privacy policy"),
            css.settingsNoteFontSp + 2, White,
            Modifier.fillMaxWidth()
                .clickable {
                    val intent = Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse("https://cat-fight.ru/echo/privacy/"))
                        .addCategory(Intent.CATEGORY_BROWSABLE)
                    runCatching { context.startActivity(intent) }
                        .onFailure { auth.message = tr(audio,
                            "Не удалось открыть политику", "Could not open privacy policy") }
                }
                .padding(vertical = 10.dp, horizontal = 8.dp),
            centered = true
        )
        if (cacheMessage.isNotEmpty()) {
            EchoText(cacheMessage, 12, Secondary, Modifier.fillMaxWidth(), centered = true)
        }
    }

    if (showAuthDialog && auth.nickname == null) {
        EchoAuthDialog(
            audio = audio,
            auth = auth,
            onVkLogin = onVkLogin,
            onOAuthLogin = { provider, link ->
                showAuthDialog = false
                onOAuthLogin(provider, link)
            },
            onDismiss = { showAuthDialog = false }
        )
    }

    if (nicknameEditor) {
        EchoConfirmDialog(
            title = tr(audio, "ИМЯ ИГРОКА", "PLAYER NAME"),
            message = if (nicknameError)
                tr(audio, "Имя: 3–20 букв, цифр, _ или -",
                    "Name: 3–20 letters, digits, _ or -")
            else tr(audio, "Введи новое имя: от 3 до 20 символов.",
                "Enter a new name: 3 to 20 characters."),
            cancelLabel = tr(audio, "ОТМЕНА", "CANCEL"),
            confirmLabel = tr(audio, "СОХРАНИТЬ", "SAVE"),
            onDismiss = { audio.click(); nicknameEditor = false },
            onConfirm = {
                audio.click()
                val value = nicknameDraft.trim()
                if (!EchoNicknamePattern.matches(value)) {
                    nicknameError = true
                } else {
                    nicknameEditor = false
                    if (value != auth.nickname) nicknameConfirmation = true
                }
            },
            content = {
                val shape = RoundedCornerShape(11.dp)
                Box(
                    Modifier.fillMaxWidth().height(52.dp)
                        .clip(shape).background(Color(0xFF080808))
                        .border(1.dp, White, shape).padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center
                ) {
                    BasicTextField(
                        value = nicknameDraft,
                        onValueChange = {
                            if (it.length <= 20) {
                                nicknameDraft = it
                                nicknameError = false
                            }
                        },
                        singleLine = true,
                        textStyle = TextStyle(
                            color = White, fontFamily = EchoFont,
                            fontSize = 20.sp, textAlign = TextAlign.Center
                        ),
                        cursorBrush = SolidColor(White),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner -> inner() }
                    )
                }
            }
        )
    }
    if (nicknameConfirmation) {
        EchoConfirmDialog(
            title = tr(audio, "ИЗМЕНИТЬ ИМЯ", "CHANGE NAME"),
            message = tr(audio, "Сохранить новое имя игрока?",
                "Save the new player name?") + "\n" + nicknameDraft.trim(),
            cancelLabel = tr(audio, "ОТМЕНА", "CANCEL"),
            confirmLabel = tr(audio, "ДА", "YES"),
            onDismiss = { audio.click(); nicknameConfirmation = false },
            onConfirm = {
                audio.click()
                nicknameConfirmation = false
                if (!auth.busy) onChangeNickname(nicknameDraft.trim())
            }
        )
    }

    if (confirmDelete) {
        EchoConfirmDialog(
            title = tr(audio, "УДАЛЕНИЕ АККАУНТА", "DELETE ACCOUNT"),
            message = tr(audio,
                "Удалить аккаунт ЭХО навсегда? Все персонажи, ECHO Coin, задания и игровой прогресс будут потеряны. Восстановить аккаунт после удаления невозможно.",
                "Permanently delete your ECHO account? Characters, ECHO Coins, quests and game progress will be lost. This cannot be undone."),
            cancelLabel = tr(audio, "ОТМЕНА", "CANCEL"),
            confirmLabel = tr(audio, "УДАЛИТЬ НАВСЕГДА", "DELETE FOREVER"),
            onDismiss = {
                audio.click()
                confirmDelete = false
            },
            onConfirm = {
                audio.click()
                confirmDelete = false
                if (!auth.busy) onDeleteAccount()
            }
        )
    }

    if (confirmLogout) {
        EchoConfirmDialog(
            title = tr(audio, "ВЫХОД", "SIGN OUT"),
            message = tr(audio, "Вы уверены, что хотите выйти из аккаунта?",
                "Are you sure you want to sign out of your account?"),
            cancelLabel = tr(audio, "НЕТ", "NO"),
            confirmLabel = tr(audio, "ДА", "YES"),
            onDismiss = {
                audio.click()
                confirmLogout = false
            },
            onConfirm = {
                audio.click()
                confirmLogout = false
                onLogout()
            }
        )
    }
    if (confirmCache) {
        EchoConfirmDialog(
            title = tr(audio, "СБРОС КЭША", "CLEAR CACHE"),
            message = tr(audio, "Вы уверены, что хотите сбросить кэш?",
                "Are you sure you want to clear the cache?"),
            cancelLabel = tr(audio, "НЕТ", "NO"),
            confirmLabel = tr(audio, "ДА", "YES"),
            onDismiss = {
                audio.click()
                confirmCache = false
            },
            onConfirm = {
                audio.click()
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
 * Native counterpart of client/auth-ui.js: five equal icon-only choices,
 * exactly one row, ECHO styling, no WebView inside the login modal.
 * VK / OK / Mail use the native VK ID SDK; Yandex / Google keep ECHO's
 * established server OAuth + external browser + PKCE deep-link flow.
 */
@Composable
private fun EchoAuthDialog(
    audio: EchoAudioEngine,
    auth: EchoAuthSession,
    onVkLogin: (OAuth) -> Unit,
    onOAuthLogin: (String, Boolean) -> Unit,
    onDismiss: () -> Unit
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
        EchoSpaceBackground(backgroundColor = Color(0xD1000000)) {
            BoxWithConstraints(
                Modifier.fillMaxSize().padding(20.dp),
                contentAlignment = Alignment.Center
            ) {
                val compact = maxHeight <= 520.dp
                val panelShape = RoundedCornerShape(13.dp)
                Column(
                    modifier = Modifier.width(minOf(maxWidth, 680.dp))
                        .heightIn(max = maxHeight)
                        .clip(panelShape).background(Black)
                        .border(1.dp, White, panelShape)
                        .verticalScroll(rememberScrollState())
                        .padding(
                            horizontal = if (compact) 22.dp else 42.dp,
                            vertical = if (compact) 24.dp else 34.dp
                        ),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    EchoText(
                        tr(audio, "АВТОРИЗАЦИЯ", "AUTHORIZATION"),
                        if (compact) 25 else 30, White,
                        Modifier.fillMaxWidth(), centered = true,
                        weight = FontWeight.SemiBold, letterSpacingEm = .12f
                    )
                    Spacer(Modifier.height(if (compact) 20.dp else 28.dp))
                    EchoText(
                        tr(audio, "Выберите способ входа", "Choose a sign-in method"),
                        if (compact) 16 else 20,
                        White, Modifier.fillMaxWidth(), centered = true
                    )
                    Spacer(Modifier.height(20.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        EchoAuthProviderButton("yandex", auth.busy, Modifier.weight(1f)) {
                            onOAuthLogin("yandex", false)
                        }
                        EchoAuthProviderButton("google", auth.busy, Modifier.weight(1f)) {
                            onOAuthLogin("google", false)
                        }
                        EchoAuthProviderButton("vk", auth.busy, Modifier.weight(1f)) {
                            onVkLogin(OAuth.VK)
                        }
                        EchoAuthProviderButton("ok", auth.busy, Modifier.weight(1f)) {
                            onVkLogin(OAuth.OK)
                        }
                        EchoAuthProviderButton("mail", auth.busy, Modifier.weight(1f)) {
                            onVkLogin(OAuth.MAIL)
                        }
                    }
                    if (auth.busy || auth.message != null) {
                        Spacer(Modifier.height(12.dp))
                        EchoText(
                            auth.message ?: tr(audio, "Подключаем...", "Connecting..."),
                            13, Secondary, Modifier.fillMaxWidth(), centered = true
                        )
                    }
                    Spacer(Modifier.height(if (compact) 32.dp else 42.dp))
                    EchoButton(
                        tr(audio, "НАЗАД", "BACK"), Modifier.fillMaxWidth(),
                        height = if (compact) 46.dp else 52.dp, fontSize = 17
                    ) {
                        if (!auth.busy) onDismiss()
                    }
                }
            }
        }
    }
}

@Composable
private fun EchoAuthProviderButton(
    provider: String,
    busy: Boolean,
    modifier: Modifier,
    onClick: () -> Unit
) {
    val audio = LocalEchoAudio.current
    val title = when (provider) {
        "yandex" -> "Яндекс ID"
        "google" -> "Google"
        "vk" -> "VK ID"
        "ok" -> "Одноклассники"
        else -> "Mail.ru"
    }
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier = modifier.height(56.dp)
            .clip(shape).background(Black).border(1.dp, White, shape)
            .semantics { contentDescription = title }
            .clickable(enabled = !busy) { audio?.click(); onClick() },
        contentAlignment = Alignment.Center
    ) {
        if (provider == "yandex") {
            Text(
                "Я", color = Color(0xFFFC3F1D),
                fontSize = 35.sp, lineHeight = 39.sp,
                fontWeight = FontWeight.ExtraBold,
                fontFamily = FontFamily.Default
            )
        } else {
            val icon = when (provider) {
                "google" -> R.drawable.echo_oauth_google
                "vk" -> R.drawable.echo_oauth_vk
                "ok" -> R.drawable.echo_oauth_ok
                else -> R.drawable.echo_oauth_mail
            }
            Image(
                painter = painterResource(icon), contentDescription = null,
                modifier = Modifier.size(32.dp),
                contentScale = ContentScale.Fit
            )
        }
    }
}

/**
 * Compose counterpart of main/client/style.css .echo-modal-overlay/.echo-modal
 * and client/modal.js ECHOModal.confirm.
 *
 * Shared by cache reset, account logout, and the native arena exit.
 * This preserves the original ECHO visual style without loading another WebView.
 */
@Composable
internal fun EchoConfirmDialog(
    title: String,
    message: String,
    cancelLabel: String?,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
    content: (@Composable () -> Unit)? = null
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            dismissOnClickOutside = false,
            dismissOnBackPress = cancelLabel != null,
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
                        text = title,
                        modifier = Modifier.fillMaxWidth(),
                        color = Color.White,
                        fontFamily = EchoFont,
                        fontSize = if (availableWidth < 600.dp) 22.sp else 28.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 0.14.em,
                        textAlign = TextAlign.Center,
                        lineHeight = 36.sp
                    )
                    Spacer(Modifier.height(if (compact) 18.dp else 30.dp))
                    Text(
                        text = message,
                        modifier = Modifier.fillMaxWidth(),
                        color = Color.White,
                        fontFamily = EchoFont,
                        fontSize = 14.sp,
                        lineHeight = 24.sp,
                        textAlign = TextAlign.Center
                    )
                    if (content != null) {
                        Spacer(Modifier.height(16.dp))
                        content()
                    }
                    Spacer(Modifier.height(if (compact) 20.dp else 36.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (cancelLabel != null) {
                            EchoModalAction(
                                label = cancelLabel,
                                primary = false,
                                modifier = Modifier.weight(1f)
                            ) {
                                onDismiss()
                            }
                        }
                        EchoModalAction(
                            label = confirmLabel,
                            primary = true,
                            modifier = Modifier.weight(1f)
                        ) {
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
            fontFamily = EchoFont,
            fontWeight = FontWeight.SemiBold,
            fontSize = 12.sp,
            letterSpacing = 0.1.em,
            textAlign = TextAlign.Center
        )
    }
}


/** Both actions use a white outline icon, not a colored system emoji. */
@Composable
private fun EchoSettingsIcon(isTrash: Boolean) {
    Canvas(Modifier.size(25.dp)) {
        val unit = size.minDimension / 24f
        val outline = Path().apply {
            if (isTrash) {
                moveTo(4f * unit, 7f * unit)
                lineTo(20f * unit, 7f * unit)
                moveTo(9f * unit, 4f * unit)
                lineTo(15f * unit, 4f * unit)
                moveTo(6f * unit, 8f * unit)
                lineTo(7f * unit, 20f * unit)
                lineTo(17f * unit, 20f * unit)
                lineTo(18f * unit, 8f * unit)
                moveTo(10f * unit, 11f * unit)
                lineTo(10f * unit, 17f * unit)
                moveTo(14f * unit, 11f * unit)
                lineTo(14f * unit, 17f * unit)
            } else {
                moveTo(4f * unit, 20f * unit)
                lineTo(9f * unit, 19f * unit)
                lineTo(20f * unit, 8f * unit)
                lineTo(16f * unit, 4f * unit)
                lineTo(5f * unit, 15f * unit)
                close()
                moveTo(14f * unit, 6f * unit)
                lineTo(18f * unit, 10f * unit)
                moveTo(4f * unit, 22f * unit)
                lineTo(20f * unit, 22f * unit)
            }
        }
        drawPath(
            outline, color = White,
            style = Stroke(width = 1.8f * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
        )
    }
}

// A continuous native volume slider with the same icy-blue circular
// handle (22px, 2px pale border, soft glow) and 7px bar as the web UI.
@OptIn(ExperimentalMaterial3Api::class)
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
            thumb = {
                Box(
                    Modifier.size(22.dp)
                        .shadow(
                            elevation = 8.dp,
                            shape = CircleShape,
                            ambientColor = Color(0x8866B6D4),
                            spotColor = Color(0x8866B6D4)
                        )
                        .background(Color(0xFF66B6D4), CircleShape)
                        .border(2.dp, Color(0xFFDBF6FF), CircleShape)
                )
            },
            track = { sliderState ->
                Canvas(Modifier.fillMaxWidth().height(7.dp)) {
                    val y = size.height / 2f
                    val thickness = 7.dp.toPx()
                    val end = size.width
                    drawLine(
                        color = Color(0x38ACD1E5),
                        start = Offset(0f, y), end = Offset(end, y),
                        strokeWidth = thickness, cap = StrokeCap.Round
                    )
                    val selectedWidth = end * sliderState.value.coerceIn(0f, 1f)
                    if (selectedWidth > 0f) {
                        drawLine(
                            color = Color(0xFF80DAFB),
                            start = Offset(0f, y), end = Offset(selectedWidth, y),
                            strokeWidth = thickness, cap = StrokeCap.Round
                        )
                    }
                }
            }
        )
    }
}
