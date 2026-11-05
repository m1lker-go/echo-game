package ru.echo.game

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.my.target.ads.InterstitialAd
import com.my.target.common.models.IAdLoadingError
import java.security.MessageDigest
import java.time.LocalDate
import java.time.ZoneId

/**
 * Android interstitial (2097075): request on every battle entry from #3.
 * A successfully loaded ad is cached for the next natural battle transition;
 * a failed load is retried in the background after a bounded cooldown.
 * Network no-fill never blocks entering an online match indefinitely.
 */
internal class EchoBattleInterstitial(private val activity: Activity) {
    private companion object {
        const val TAG = "EchoBattleAd"
        const val SLOT_ID = 2097075
        const val ENTRY_WAIT_MS = 6500L
        const val RETRY_DELAY_MS = 45000L
        const val CACHE_TTL_MS = 30 * 60 * 1000L
        val MOSCOW = ZoneId.of("Europe/Moscow")
    }

    private val preferences =
        activity.getSharedPreferences("echo.android.battle-entries", Context.MODE_PRIVATE)
    private val handler = Handler(Looper.getMainLooper())
    private var cached: InterstitialAd? = null
    private var loading: InterstitialAd? = null
    private var showing: InterstitialAd? = null
    private var cachedAt = 0L
    private var nextLoadAt = 0L
    private var retryTask: Runnable? = null
    private var entryTimeout: Runnable? = null
    private var pendingEntry: (() -> Unit)? = null
    private var mayRequestAds = false
    private var destroyed = false

    private fun shouldShow(token: String?): Boolean {
        val identity = if (token.isNullOrBlank()) {
            "guest"
        } else {
            // Never persist the bearer token itself.
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
        if (destroyed || activity.isFinishing || activity.isDestroyed || pendingEntry != null) return
        if (!token.isNullOrBlank()) {
            EchoAdFreeAccess.check(activity, token) { paid ->
                if (destroyed || activity.isFinishing || activity.isDestroyed) return@check
                if (paid != false) {
                    // Unknown entitlement must not accidentally show ads to paid users.
                    mayRequestAds = false
                    discardCached()
                    Log.i(TAG, if (paid == true) "Interstitial skipped: account is ad-free"
                        else "Interstitial skipped: entitlement status unavailable")
                    proceed()
                } else {
                    mayRequestAds = true
                    requestBeforeBattle(token, proceed)
                }
            }
        } else {
            mayRequestAds = true
            requestBeforeBattle(token, proceed)
        }
    }

    private fun requestBeforeBattle(token: String?, proceed: () -> Unit) {
        if (destroyed || activity.isFinishing || activity.isDestroyed || pendingEntry != null) return
        if (!shouldShow(token)) {
            proceed()
            // Warm one ad in case the player uses Replay in this same arena.
            preload()
            return
        }
        pendingEntry = proceed
        if (tryShowCached()) return
        // Never start repeated load() calls for rapid re-entry: an existing
        // request or a no-fill cooldown is shared with the preloader.
        preload()
        if (pendingEntry != null) {
            if (SystemClock.elapsedRealtime() < nextLoadAt) {
                Log.i(TAG, "Interstitial in no-fill cooldown; entering battle")
                finishEntry("cooldown")
            } else {
                val timer = Runnable {
                    entryTimeout = null
                    if (pendingEntry != null && showing == null) {
                        Log.i(TAG, "Interstitial still loading; entering battle")
                        finishEntry("entry_timeout")
                        // Keep the in-flight load: a late onLoad can warm Replay.
                    }
                }
                entryTimeout = timer
                handler.postDelayed(timer, ENTRY_WAIT_MS)
            }
        }
    }

    private fun finishEntry(reason: String) {
        val proceed = pendingEntry ?: return
        pendingEntry = null
        entryTimeout?.let { handler.removeCallbacks(it) }
        entryTimeout = null
        Log.i(TAG, "Interstitial entry resolved: $reason")
        if (!destroyed && !activity.isFinishing && !activity.isDestroyed) proceed()
    }

    private fun discardCached() {
        cached?.let { runCatching { it.dismiss() } }
        cached = null
        cachedAt = 0L
    }

    private fun tryShowCached(): Boolean {
        val ad = cached ?: return false
        val age = SystemClock.elapsedRealtime() - cachedAt
        if (age < 0 || age > CACHE_TTL_MS) {
            Log.i(TAG, "Cached interstitial expired; reloading")
            discardCached()
            return false
        }
        cached = null
        cachedAt = 0L
        showing = ad
        entryTimeout?.let { handler.removeCallbacks(it) }
        entryTimeout = null
        try {
            Log.i(TAG, "Showing preloaded interstitial slot=$SLOT_ID")
            ad.show()
        } catch (error: Exception) {
            Log.w(TAG, "Cannot display preloaded interstitial", error)
            showing = null
            finishEntry("show_exception")
            scheduleFailureRetry()
        }
        return true
    }

    private fun scheduleFailureRetry() {
        nextLoadAt = SystemClock.elapsedRealtime() + RETRY_DELAY_MS
        preload()
    }

    private fun preload() {
        if (destroyed || !mayRequestAds || activity.isFinishing || activity.isDestroyed ||
            loading != null || cached != null || showing != null) return
        val delay = nextLoadAt - SystemClock.elapsedRealtime()
        if (delay > 0) {
            if (retryTask == null) {
                val task = Runnable { retryTask = null; preload() }
                retryTask = task
                handler.postDelayed(task, delay)
                Log.i(TAG, "Interstitial preload retry in ${delay}ms")
            }
            return
        }
        retryTask?.let { handler.removeCallbacks(it) }
        retryTask = null
        val ad = InterstitialAd(SLOT_ID, activity)
        loading = ad
        val trace = EchoAdDiagnostics.Trace("interstitial", SLOT_ID)
        ad.listener2 = object : InterstitialAd.InterstitialAdListener2() {
            override fun onLoad(interstitialAd: InterstitialAd) {
                if (loading !== ad || destroyed) return
                loading = null
                if (!mayRequestAds) { runCatching { ad.dismiss() }; return }
                nextLoadAt = 0L
                cached = ad
                cachedAt = SystemClock.elapsedRealtime()
                trace.event("onLoad")
                Log.i(TAG, "Interstitial preloaded slot=$SLOT_ID")
                if (pendingEntry != null) tryShowCached()
            }
            override fun onNoAd(error: IAdLoadingError, adFromSdk: InterstitialAd) {
                if (loading !== ad || destroyed) return
                loading = null
                trace.noAd(error)
                Log.i(TAG, "Interstitial unavailable slot=$SLOT_ID: " + error.message)
                finishEntry("no_fill")
                scheduleFailureRetry()
            }
            override fun onDisplay(interstitialAd: InterstitialAd) {
                if (showing === ad) {
                    trace.event("onDisplay")
                    Log.i(TAG, "Interstitial displayed slot=$SLOT_ID")
                }
            }
            override fun onFailedToShow(interstitialAd: InterstitialAd) {
                if (showing !== ad || destroyed) return
                trace.event("onFailedToShow")
                Log.w(TAG, "Interstitial failed to show slot=$SLOT_ID")
                showing = null
                finishEntry("failed_to_show")
                scheduleFailureRetry()
            }
            override fun onClose(interstitialAd: InterstitialAd) {
                if (showing !== ad || destroyed) return
                trace.event("onClose")
                Log.i(TAG, "Interstitial closed slot=$SLOT_ID")
                showing = null
                finishEntry("closed")
                // Every impression consumes its ad; load a fresh one for Replay.
                preload()
            }
        }
        try {
            Log.i(TAG, "Preloading interstitial slot=$SLOT_ID")
            trace.event("load_start")
            ad.load()
            trace.event("load_returned")
        } catch (error: Exception) {
            if (loading === ad) loading = null
            trace.failure("load", error)
            Log.w(TAG, "Interstitial preload failed", error)
            finishEntry("load_exception")
            scheduleFailureRetry()
        }
    }

    fun destroy() {
        destroyed = true
        mayRequestAds = false
        entryTimeout?.let { handler.removeCallbacks(it) }
        entryTimeout = null
        retryTask?.let { handler.removeCallbacks(it) }
        retryTask = null
        pendingEntry = null
        discardCached()
        loading?.let { runCatching { it.dismiss() } }
        loading = null
        showing?.let { runCatching { it.dismiss() } }
        showing = null
    }
}
