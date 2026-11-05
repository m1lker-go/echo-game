package ru.echo.game

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.my.target.ads.Reward
import com.my.target.ads.RewardedAd
import com.my.target.common.models.IAdLoadingError
import org.json.JSONObject

/**
 * Rewarded slot 2096987. Preload once when Quests opens; reuse a ready ad
 * only on a player's explicit request. Only onReward confirms a reward.
 * No-fill triggers delayed background retries, never a tight retry loop.
 */
internal class EchoRewardedAds(
    private val activity: Activity,
    private val webView: WebView
) {
    private companion object {
        const val TAG = "EchoRewardedAds"
        const val PLACEMENT_ID = 2096987
        const val RETRY_DELAY_MS = 45000L
        const val CACHE_TTL_MS = 30 * 60 * 1000L
        const val REQUEST_WAIT_MS = 9000L
        const val LATE_REWARD_GRACE_MS = 700L
        val VALID_REQUEST = Regex("^[a-fA-F0-9-]{36}$")
    }

    private val handler = Handler(Looper.getMainLooper())
    private var cached: RewardedAd? = null
    private var loading: RewardedAd? = null
    private var showing: RewardedAd? = null
    private var recentlyClosed: RewardedAd? = null
    private var cachedAt = 0L
    private var nextLoadAt = 0L
    private var retryTask: Runnable? = null
    private var requestTimeout: Runnable? = null
    private var closedGrace: Runnable? = null
    private var requestId: String? = null
    private var rewardDelivered = false
    private var destroyed = false

    /** Called from the Activity after the trusted Quests bridge is installed. */
    fun preload() {
        if (destroyed || activity.isFinishing || activity.isDestroyed ||
            cached != null || loading != null || showing != null || recentlyClosed != null) return
        val delay = nextLoadAt - SystemClock.elapsedRealtime()
        if (delay > 0) {
            if (retryTask == null) {
                val task = Runnable { retryTask = null; preload() }
                retryTask = task
                handler.postDelayed(task, delay)
                Log.i(TAG, "Rewarded preload retry in ${delay}ms")
            }
            return
        }
        retryTask?.let { handler.removeCallbacks(it) }
        retryTask = null
        val rewarded = RewardedAd(PLACEMENT_ID, activity)
        loading = rewarded
        val trace = EchoAdDiagnostics.Trace("rewarded", PLACEMENT_ID)
        rewarded.listener = object : RewardedAd.RewardedAdListener {
            override fun onLoad(rewardedAd: RewardedAd) {
                if (loading !== rewarded || destroyed) return
                loading = null
                cached = rewarded
                cachedAt = SystemClock.elapsedRealtime()
                nextLoadAt = 0L
                trace.event("onLoad")
                Log.i(TAG, "Rewarded preloaded slot=$PLACEMENT_ID")
                if (requestId != null) showCached()
            }
            override fun onNoAd(error: IAdLoadingError, rewardedAd: RewardedAd) {
                if (loading !== rewarded || destroyed) return
                loading = null
                trace.noAd(error)
                Log.w(TAG, "Rewarded unavailable slot=$PLACEMENT_ID: " + error.message)
                failPending()
                scheduleFailureRetry()
            }
            override fun onDisplay(rewardedAd: RewardedAd) {
                if (showing === rewarded) {
                    trace.event("onDisplay")
                    Log.i(TAG, "Rewarded displayed slot=$PLACEMENT_ID")
                }
            }
            override fun onClick(rewardedAd: RewardedAd) {
                if (showing === rewarded) trace.event("onClick")
            }
            override fun onFailedToShow(rewardedAd: RewardedAd) {
                if (showing !== rewarded || destroyed) return
                trace.event("onFailedToShow")
                Log.w(TAG, "Rewarded failed to show slot=$PLACEMENT_ID")
                showing = null
                failPending()
                scheduleFailureRetry()
            }
            override fun onReward(reward: Reward, rewardedAd: RewardedAd) {
                if (destroyed || (showing !== rewarded && recentlyClosed !== rewarded) ||
                    rewardDelivered) return
                val id = requestId ?: return
                rewardDelivered = true
                trace.event("onReward")
                Log.i(TAG, "Rewarded earned slot=$PLACEMENT_ID")
                dispatch(id, true)
                // Some SDK/creative callbacks may arrive just after dismissal.
                if (recentlyClosed === rewarded) {
                    closedGrace?.let { handler.removeCallbacks(it) }
                    closedGrace = null
                    recentlyClosed = null
                    finishAttempt()
                    preload()
                }
            }
            override fun onDismiss(rewardedAd: RewardedAd) {
                if (showing !== rewarded || destroyed) return
                trace.event("onDismiss")
                Log.i(TAG, "Rewarded dismissed slot=$PLACEMENT_ID reward=$rewardDelivered")
                showing = null
                if (rewardDelivered) {
                    finishAttempt()
                    preload()
                } else {
                    recentlyClosed = rewarded
                    val timer = Runnable {
                        if (recentlyClosed !== rewarded || destroyed) return@Runnable
                        recentlyClosed = null
                        failPending()
                        preload()
                    }
                    closedGrace = timer
                    handler.postDelayed(timer, LATE_REWARD_GRACE_MS)
                }
            }
        }
        try {
            Log.i(TAG, "Preloading rewarded slot=$PLACEMENT_ID")
            trace.event("load_start")
            rewarded.load()
            trace.event("load_returned")
        } catch (error: Exception) {
            if (loading === rewarded) loading = null
            trace.failure("load", error)
            Log.w(TAG, "Rewarded preload failed", error)
            failPending()
            scheduleFailureRetry()
        }
    }

    @JavascriptInterface
    fun showRewardedVideo(attemptId: String) {
        if (!VALID_REQUEST.matches(attemptId)) return
        activity.runOnUiThread {
            if (destroyed || activity.isFinishing || activity.isDestroyed) return@runOnUiThread
            if (requestId != null || showing != null || recentlyClosed != null) {
                dispatch(attemptId, false)
                return@runOnUiThread
            }
            requestId = attemptId
            rewardDelivered = false
            Log.i(TAG, "Rewarded requested slot=$PLACEMENT_ID")
            if (showCached()) return@runOnUiThread
            if (SystemClock.elapsedRealtime() < nextLoadAt) {
                Log.i(TAG, "Rewarded in no-fill cooldown")
                failPending()
                return@runOnUiThread
            }
            preload()
            // A late response warms the next attempt rather than interrupting play.
            val timer = Runnable {
                requestTimeout = null
                if (requestId == attemptId && showing == null) {
                    Log.i(TAG, "Rewarded request timed out; keeping preload active")
                    failPending()
                }
            }
            if (requestId == attemptId && showing == null) {
                requestTimeout = timer
                handler.postDelayed(timer, REQUEST_WAIT_MS)
            }
        }
    }

    private fun showCached(): Boolean {
        val ad = cached ?: return false
        val age = SystemClock.elapsedRealtime() - cachedAt
        if (age < 0 || age > CACHE_TTL_MS) {
            Log.i(TAG, "Cached rewarded expired; reloading")
            cached = null
            cachedAt = 0L
            runCatching { ad.dismiss() }
            return false
        }
        if (requestId == null) return false
        requestTimeout?.let { handler.removeCallbacks(it) }
        requestTimeout = null
        cached = null
        cachedAt = 0L
        showing = ad
        try {
            Log.i(TAG, "Showing preloaded rewarded slot=$PLACEMENT_ID")
            ad.show()
        } catch (error: Exception) {
            Log.w(TAG, "Cannot display preloaded rewarded", error)
            showing = null
            failPending()
            scheduleFailureRetry()
        }
        return true
    }

    private fun finishAttempt() {
        requestTimeout?.let { handler.removeCallbacks(it) }
        requestTimeout = null
        requestId = null
        rewardDelivered = false
    }

    private fun failPending() {
        val pending = requestId ?: return
        if (!rewardDelivered) dispatch(pending, false)
        finishAttempt()
    }

    private fun scheduleFailureRetry() {
        nextLoadAt = SystemClock.elapsedRealtime() + RETRY_DELAY_MS
        preload()
    }

    private fun dispatch(id: String, watched: Boolean) {
        activity.runOnUiThread {
            if (destroyed || activity.isFinishing || activity.isDestroyed) return@runOnUiThread
            val js = "window.dispatchEvent(new CustomEvent('echo:native-rewarded-result'," +
                "{detail:{attemptId:" + JSONObject.quote(id) + ",watched:" + watched + "}}))"
            webView.evaluateJavascript(js, null)
        }
    }

    fun destroy() {
        destroyed = true
        requestTimeout?.let { handler.removeCallbacks(it) }
        requestTimeout = null
        retryTask?.let { handler.removeCallbacks(it) }
        retryTask = null
        closedGrace?.let { handler.removeCallbacks(it) }
        closedGrace = null
        requestId = null
        cached?.let { runCatching { it.dismiss() } }
        cached = null
        loading?.let { runCatching { it.dismiss() } }
        loading = null
        showing?.let { runCatching { it.dismiss() } }
        showing = null
        recentlyClosed = null
    }
}
