package ru.echo.game

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.view.View
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * Opaque Android loading surface displayed above the real ECHO WebView.
 * It matches the native menu particle motion rather than showing the
 * intermediate website home menu while JS opens the requested subpage.
 *
 * This is a View, not a second WebView or WebGL renderer. It receives no
 * session credentials and is removed before the player can interact.
 */
internal class EchoWebLoadingView(context: Context) : View(context) {
    private data class Particle(
        val x: Float, val y: Float, val radius: Float,
        val phase: Float, val speed: Float, val drift: Float
    )
    private val random = Random.Default
    private val particles = List(46) {
        Particle(
            random.nextFloat(), random.nextFloat(),
            1.8f + random.nextFloat() * 2.6f,
            random.nextFloat() * (Math.PI.toFloat() * 2f),
            .00008f + random.nextFloat() * .00012f,
            .00015f + random.nextFloat() * .00025f
        )
    }
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG)
    private val star = Paint(Paint.ANTI_ALIAS_FLAG)
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(3f)
        strokeCap = Paint.Cap.ROUND
        color = Color.argb(55, 220, 242, 255)
    }
    private val progress = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(3f)
        strokeCap = Paint.Cap.ROUND
        color = Color.rgb(223, 245, 255)
    }
    private val title = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        color = Color.rgb(241, 244, 247)
        textSize = 21f * resources.displayMetrics.scaledDensity
        typeface = runCatching { resources.getFont(R.font.echo_superxp) }.getOrNull()
    }
    private val arc = RectF()
    private var started = SystemClock.uptimeMillis()

    init {
        setBackgroundColor(Color.BLACK)
        isClickable = true // Don't let taps reach a menu that is not ready.
        contentDescription = "Загрузка страницы"
    }

    private fun dp(value: Float) = value * resources.displayMetrics.density

    fun restart() {
        started = SystemClock.uptimeMillis()
        visibility = VISIBLE
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.BLACK)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return
        val time = (SystemClock.uptimeMillis() - started).toFloat()
        for (dot in particles) {
            val x = ((dot.x * w + sin(time * dot.speed + dot.phase) * dp(28f)) % w + w) % w
            val y = ((dot.y * h + cos(time * dot.drift + dot.phase) * dp(22f)) % h + h) % h
            val pulse = .55f + .45f * sin(time * .0022f + dot.phase)
            val r = dot.radius * pulse * resources.displayMetrics.density
            glow.color = Color.argb((38f * pulse).toInt().coerceIn(0, 255), 190, 222, 249)
            canvas.drawCircle(x, y, r * 4.2f, glow)
            star.color = Color.argb((85f + pulse * 125f).toInt().coerceIn(0, 255), 235, 248, 255)
            canvas.drawCircle(x, y, r, star)
        }
        val cx = w / 2f
        val cy = h / 2f
        canvas.drawText("Загрузка страницы", cx, cy - dp(22f), title)
        val spinnerY = cy + dp(30f)
        val radius = dp(16f)
        arc.set(cx - radius, spinnerY - radius, cx + radius, spinnerY + radius)
        canvas.drawArc(arc, 0f, 360f, false, track)
        canvas.drawArc(arc, ((time * .36f) % 360f) - 90f, 105f, false, progress)
        if (visibility == VISIBLE) postInvalidateOnAnimation()
    }
}
