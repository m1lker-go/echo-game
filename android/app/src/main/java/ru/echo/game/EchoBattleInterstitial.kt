package ru.echo.game

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.my.target.ads.InterstitialAd
import com.my.target.common.models.IAdLoadingError
import java.security.MessageDigest
import java.time.LocalDate
import java.time.ZoneId

/**
 * Android interstitial 2097075. Guest entries: 3,5,7...
 * Signed-in entries: 5,7,9...; reset each Moscow calendar day.
 * No fill, SDK errors and slow requests never prevent joining battle.
 */
internal class EchoBattleInterstitial(private val activity: Activity) {
    private companion object {
        const val TAG = "EchoBattleAd"
        const val SLOT_ID = 2097075
        const val LOAD_TIMEOUT_MS = 6500L
        val MOSCOW = ZoneId.of("Europe/Moscow")
    }

    private val preferences =
        activity.getSharedPreferences("echo.android.battle-entries", Context.MODE_PRIVATE)
    private val handler = Handler(Looper.getMainLooper())
    private var active: InterstitialAd? = null
    private var timeout: Runnable? = null
    private var epoch = 0
    private var destroyed = false

    private fun shouldShow(token: String?): Boolean {
        val identity = if (token.isNullOrBlank()) {
            "guest"
        } else {
            // Never persist the session bearer token itself.
            val digest = MessageDigest.getInstance("SHA-256").digest(token.toByteArray())
            "account-" + digest.take(8).joinToString("") { "%02x".format(it) }
        }
        val date = LocalDate.now(MOSCOW).toString()
        val dateKey = "$identity.day"
        val countKey = "$identity.count"
        val previous = if (preferences.getString(dateKey, null) == date) {
            preferences.getInt(countKey, 0).coerceIn(0, 100000)
        } else 0
        val count = previous + 1
        preferences.edit().putString(dateKey, date).putInt(countKey, count).apply()
        val first = if (token.isNullOrBlank()) 3 else 5
        val due = count >= first && count % 2 == 1
        Log.i(TAG, "Daily battle entry #$count, interstitial scheduled: $due")
        return due
    }

    fun beforeBattle(token: String?, proceed: () -> Unit) {
        if (destroyed || activity.isFinishing || activity.isDestroyed) return
        if (!shouldShow(token)) {
            proceed()
            return
        }
        if (active != null) return

        val serial = ++epoch
        var finished = false
        fun finish() {
            if (finished || serial != epoch) return
            finished = true
            timeout?.let { handler.removeCallbacks(it) }
            timeout = null
            active = null
            if (!destroyed && !activity.isFinishing && !activity.isDestroyed) proceed()
        }

        try {
            val ad = InterstitialAd(SLOT_ID, activity)
            active = ad
            ad.listener2 = object : InterstitialAd.InterstitialAdListener2() {
                override fun onLoad(interstitialAd: InterstitialAd) {
                    if (finished || serial != epoch || destroyed) return
                    // Once visible, wait for real close; never start the game
                    // underneath an active interstitial.
                    timeout?.let { handler.removeCallbacks(it) }
                    timeout = null
                    try {
                        interstitialAd.show()
                    } catch (error: Exception) {
                        Log.w(TAG, "Cannot display interstitial", error)
                        finish()
                    }
                }
                override fun onDisplay(interstitialAd: InterstitialAd) = Unit
                override fun onNoAd(error: IAdLoadingError, ad: InterstitialAd) {
                    Log.i(TAG, "Interstitial unavailable: " + error.message)
                    finish()
                }
                override fun onFailedToShow(interstitialAd: InterstitialAd) {
                    Log.w(TAG, "Interstitial failed to show")
                    finish()
                }
                override fun onClose(ad: InterstitialAd) {
                    finish()
                }
            }
            val timer = Runnable {
                if (active === ad && !finished) {
                    Log.i(TAG, "Interstitial loading timeout; entering battle")
                    finish()
                    runCatching { ad.dismiss() }
                }
            }
            timeout = timer
            handler.postDelayed(timer, LOAD_TIMEOUT_MS)
            ad.load()
        } catch (error: Exception) {
            Log.w(TAG, "Cannot initialize interstitial", error)
            finish()
        }
    }

    fun destroy() {
        destroyed = true
        epoch++
        timeout?.let { handler.removeCallbacks(it) }
        timeout = null
        active?.dismiss()
        active = null
    }
}
