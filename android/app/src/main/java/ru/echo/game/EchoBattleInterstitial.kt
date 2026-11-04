package ru.echo.game

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import com.my.target.ads.InterstitialAd
import com.my.target.common.models.IAdLoadingError
import java.security.MessageDigest
import java.time.LocalDate
import java.time.ZoneId

/**
 * Android interstitial 2097075. TEMPORARY TEST: every battle entry from #3
 * for both guests and signed-in users; reset each Moscow calendar day.
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
        val due = count >= 3
        Log.i(TAG, "Daily battle entry #$count, interstitial scheduled: $due")
        return due
    }

    fun beforeBattle(token: String?, proceed: () -> Unit) {
        if (destroyed || activity.isFinishing || activity.isDestroyed) return
        if (!token.isNullOrBlank()) {
            EchoAdFreeAccess.check(activity, token) { active ->
                if (destroyed || activity.isFinishing || activity.isDestroyed) return@check
                if (active != false) {
                    Log.i(TAG, if (active == true) "Interstitial skipped: account is ad-free"
                        else "Interstitial skipped: entitlement status unavailable")
                    proceed()
                } else requestBeforeBattle(token, proceed)
            }
            return
        }
        requestBeforeBattle(token, proceed)
    }

    private fun requestBeforeBattle(token: String?, proceed: () -> Unit) {
        if (destroyed || activity.isFinishing || activity.isDestroyed) return
        if (!shouldShow(token)) {
            proceed()
            return
        }
        if (active != null) return

        val serial = ++epoch
        val trace = EchoAdDiagnostics.Trace("interstitial", SLOT_ID)
        var finished = false
        fun finish() {
            if (finished || serial != epoch) return
            finished = true
            timeout?.let { handler.removeCallbacks(it) }
            timeout = null
            active = null
            trace.event("proceed_to_battle")
            if (!destroyed && !activity.isFinishing && !activity.isDestroyed) proceed()
        }

        try {
            Log.i(TAG, "Requesting interstitial slot=$SLOT_ID")
            val ad = InterstitialAd(SLOT_ID, activity)
            active = ad
            ad.listener2 = object : InterstitialAd.InterstitialAdListener2() {
                override fun onLoad(interstitialAd: InterstitialAd) {
                    if (finished || serial != epoch || destroyed) return
                    trace.event("onLoad")
                    Log.i(TAG, "Interstitial loaded slot=$SLOT_ID")
                    // Once visible, wait for real close; never start the game
                    // underneath an active interstitial.
                    timeout?.let { handler.removeCallbacks(it) }
                    timeout = null
                    try {
                        trace.event("show_start")
                        interstitialAd.show()
                    } catch (error: Exception) {
                        trace.failure("show", error)
                        Log.w(TAG, "Cannot display interstitial", error)
                        finish()
                    }
                }
                override fun onDisplay(interstitialAd: InterstitialAd) {
                    trace.event("onDisplay")
                    Log.i(TAG, "Interstitial displayed slot=$SLOT_ID")
                }
                override fun onNoAd(error: IAdLoadingError, ad: InterstitialAd) {
                    trace.noAd(error)
                    Log.i(TAG, "Interstitial unavailable slot=$SLOT_ID: " + error.message)
                    // No-fill is expected at times: do not show repeated error toasts to players.
                    finish()
                }
                override fun onFailedToShow(interstitialAd: InterstitialAd) {
                    trace.event("onFailedToShow")
                    Log.w(TAG, "Interstitial failed to show")
                    Toast.makeText(activity, "Не удалось показать рекламу", Toast.LENGTH_SHORT).show()
                    finish()
                }
                override fun onClose(ad: InterstitialAd) {
                    trace.event("onClose")
                    Log.i(TAG, "Interstitial closed slot=$SLOT_ID")
                    finish()
                }
            }
            val timer = Runnable {
                if (active === ad && !finished) {
                    trace.event("timeout", "limitMs=$LOAD_TIMEOUT_MS")
                    Log.i(TAG, "Interstitial loading timeout; entering battle")
                    Toast.makeText(activity, "Реклама не загрузилась", Toast.LENGTH_SHORT).show()
                    finish()
                    runCatching { ad.dismiss() }
                }
            }
            timeout = timer
            handler.postDelayed(timer, LOAD_TIMEOUT_MS)
            trace.event("load_start")
            ad.load()
            trace.event("load_returned")
        } catch (error: Exception) {
            trace.failure("load_or_init", error)
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
