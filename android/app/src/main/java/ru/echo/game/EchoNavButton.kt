package ru.echo.game

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View

/**
 * Native counterpart of main/client/fullscreen.css, shared top-right
 * #game-exit. On menu subpages the CSS uses a left-chevron; in battle
 * its SVG draws a cross. Android never shows the fullscreen control.
 */
internal class EchoNavButton(
    context: Context,
    private val mode: Mode
) : View(context) {
    enum class Mode { BACK, CLOSE }

    private val density = resources.displayMetrics.density
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.BLACK
    }
    private val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = Color.argb(179, 255, 255, 255) // CSS rgba(255,255,255,.7)
        strokeWidth = density
    }
    private val symbol = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = Color.WHITE
        strokeWidth = density * if (mode == Mode.CLOSE) 2.2f else 3f
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
    }
    private val shape = RectF()
    private val glyph = Path()

    init {
        isClickable = true
        isFocusable = true
        contentDescription = if (mode == Mode.CLOSE) "Закрыть игру" else "Назад"
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return
        val halfBorder = density * 0.5f
        val radius = 10f * density
        shape.set(halfBorder, halfBorder, w - halfBorder, h - halfBorder)
        canvas.drawRoundRect(shape, radius, radius, fill)
        canvas.drawRoundRect(shape, radius, radius, outline)

        val cx = w / 2f
        val cy = h / 2f
        glyph.reset()
        if (mode == Mode.CLOSE) {
            // Original SVG viewBox 24, M5 5l14 14 M19 5L5 19,
            // drawn inside the square after 7px padding.
            val extent = 8.75f * density
            glyph.moveTo(cx - extent, cy - extent)
            glyph.lineTo(cx + extent, cy + extent)
            glyph.moveTo(cx + extent, cy - extent)
            glyph.lineTo(cx - extent, cy + extent)
        } else {
            // Original CSS pseudo-element: 14px chevron at 3px stroke.
            val extent = 7f * density
            glyph.moveTo(cx + extent * .55f, cy - extent)
            glyph.lineTo(cx - extent * .55f, cy)
            glyph.lineTo(cx + extent * .55f, cy + extent)
        }
        canvas.drawPath(glyph, symbol)
    }
}
