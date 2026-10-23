package ru.echo.game

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Native equivalents of the source-of-truth CSS tokens.
 *
 * Source: main/client/{ui-layout.css,menu-width.css,settings-refresh.css,
 * style.css,landscape-menu-layout.css,echo-font.css}.
 *
 * The web client scales its UI by viewportHeight / 700px (game.js).
 * Compose units are logical dp rather than CSS px, so these values preserve
 * the layout's relative proportions in landscape, not device-pixel identity.
 */
internal data class EchoCss(private val viewportHeight: Dp) {
    val scale: Float = viewportHeight.value / 700f

    private fun clamp(min: Float, preferred: Float, max: Float): Float =
        preferred.coerceIn(min, max)

    // client/menu-width.css: min(100dvh, calc(100vw - 40px))
    fun contentWidth(viewportWidth: Dp): Dp =
        minOf(viewportHeight, viewportWidth - 40.dp)

    // client/ui-layout.css: main menu typography and gaps.
    val logoFontSp: Int get() = clamp(32f, 54f * scale, 70f).toInt()
    val menuFontSp: Int get() = clamp(17f, 25f * scale, 32f).toInt()
    val mainButtonsGap: Dp get() = clamp(16f, 40f * scale, 52f).dp
    val mainLogoGap: Dp get() = clamp(16f, 24f * scale, 32f).dp

    // client/ui-layout.css + client/style.css
    val menuBackHeight: Dp get() = (50f * scale).coerceAtLeast(34f).dp
    val menuBackFontSp: Int get() = clamp(14f, 14f * scale, 21f).toInt()
    val settingsTitleSp: Int get() = clamp(22f, 32f * scale, 38f).toInt()

    // client/settings-refresh.css + client/ui-layout.css
    val settingsButtonHeight: Dp get() = clamp(48f, 58f * scale, 96f).dp
    val settingsButtonFontSp: Int get() = clamp(17f, 24f * scale, 32f).toInt()
    val settingsLabelFontSp: Int get() = clamp(13f, 16f * scale, 22f).toInt()
    val settingsValueFontSp: Int get() = clamp(15f, 21f * scale, 30f).toInt()
    val settingsNoteFontSp: Int get() = clamp(13f, 16f * scale, 23f).toInt()

    val menuBorderRadius: Dp = 13.dp
    val menuBorderWidth: Dp = 1.dp
}
