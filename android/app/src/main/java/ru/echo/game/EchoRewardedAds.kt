package ru.echo.game

import android.app.Activity
import android.content.Context
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
 * Rewarded slot 2096987. Start warming in the native home menu for a
 * server-verified non-ad-free account, then reuse the same ready ad in Quests.
 * Only onReward confirms a reward.
 * No-fill triggers delayed background retries, never a tight retry loop.
 */
internal class EchoRewardedAds private constructor(private val appContext: Context) {
    companion object {
        const val TAG = "EchoRewardedAds"
        const val PLACEMENT_ID = 2096987
        const val RETRY_DELAY_MS = 45000L
        const val CACHE_TTL_MS = 30 * 60 * 1000L
        const val REQUEST_WAIT_MS = 9000L
        const val LATE_REWARD_GRACE_MS = 700L
        private const val ENTITLEMENT_TTL_MS = 60000L
        val VALID_REQUEST = Regex("^[a-fA-F0-9-]{36}$")

        private var shared: EchoRewardedAds? = null
        fun get(context: Context): EchoRewardedAds =
            shared ?: synchronized(this) {
                shared ?: EchoRewardedAds(context.applicationContext).also { shared = it }
            }
    }

    // This singleton holds only application context outside the Quests screen.
    // The WebView and Activity are attached temporarily for explicit rewarded requests.
    private var activity: Activity? = null
    private var webView: WebView? = null
    private var accountToken: String? = null
    private var adFree: Boolean? = null
    private var checkedAt = 0L
    private var checking = false
    private var checkId = 0

    /** Start in MainActivity (and refresh in Quests), never before server verification. */
    fun prepare(host: Activity, token: String?, refresh: Boolean = false) {
        if (token != accountToken) {
            resetAds()
            accountToken = token
            adFree = null
            checkedAt = 0L
            checking = false
            checkId++
        }
        if (token == null || checking) return
        val age = SystemClock.elapsedRealtime() - checkedAt
        if (!refresh && adFree != null && age >= 0L && age < ENTITLEMENT_TTL_MS) {
            if (adFree == false) preload()
            return
        }
        val currentCheck = ++checkId
        checking = true
        EchoAdFreeAccess.check(host, token) { paid ->
            if (currentCheck != checkId || accountToken != token) return@check
            checking = false
            adFree = paid
            checkedAt = SystemClock.elapsedRealtime()
            if (paid == false) {
                preload()
            } else {
                // No preloading for ad-free accounts or unverified entitlement.
                resetAds()
            }
        }
    }

    fun attachQuests(host: Activity, questsWeb: WebView) {
        activity = host
        webView = questsWeb
        prepare(host, EchoAuthSession(appContext).token())
    }

    fun detachQuests(host: Activity) {
        if (activity !== host) return
        failPending()
        activity = null
        webView = null
        // Cached ad, in-flight load and cooldown survive navigation to the menu.
    }

    private fun resetAds() {
        failPending()
        requestTimeout?.let { handler.removeCallbacks(it) }
        retryTask?.let { handler.removeCallbacks(it) }
        closedGrace?.let { handler.removeCallbacks(it) }
        requestTimeout = null
        retryTask = null
        closedGrace = null
        cached?.let { runCatching { it.dismiss() } }
        loading?.let { runCatching { it.dismiss() } }
        showing?.let { runCatching { it.dismiss() } }
        recentlyClosed?.let { runCatching { it.dismiss() } }
        cached = null
        loading = null
        showing = null
        recentlyClosed = null
        cachedAt = 0L
        nextLoadAt = 0L
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

    /** One in-flight load and one cached ad shared between native menu and Quests. */
    fun preload() {
        if (accountToken == null || (adFree != false && requestId == null) ||
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
        val rewarded = RewardedAd(PLACEMENT_ID, appContext)
        loading = rewarded
        val trace = EchoAdDiagnostics.Trace("rewarded", PLACEMENT_ID)
        rewarded.listener = object : RewardedAd.RewardedAdListener {
            override fun onLoad(rewardedAd: RewardedAd) {
                if (loading !== rewarded) return
                loading = null
                cached = rewarded
                cachedAt = SystemClock.elapsedRealtime()
                nextLoadAt = 0L
                trace.event("onLoad")
                Log.i(TAG, "Rewarded preloaded slot=$PLACEMENT_ID")
                if (requestId != null) showCached()
            }
            override fun onNoAd(error: IAdLoadingError, rewardedAd: RewardedAd) {
                if (loading !== rewarded) return
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
                if (showing !== rewarded) return
                trace.event("onFailedToShow")
                Log.w(TAG, "Rewarded failed to show slot=$PLACEMENT_ID")
                showing = null
                failPending()
                scheduleFailureRetry()
            }
            override fun onReward(reward: Reward, rewardedAd: RewardedAd) {
                if ((showing !== rewarded && recentlyClosed !== rewarded) ||
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
                if (showing !== rewarded) return
                trace.event("onDismiss")
                Log.i(TAG, "Rewarded dismissed slot=$PLACEMENT_ID reward=$rewardDelivered")
                showing = null
                if (rewardDelivered) {
                    finishAttempt()
                    preload()
                } else {
                    recentlyClosed = rewarded
                    val timer = Runnable {
                        if (recentlyClosed !== rewarded) return@Runnable
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
        val host = activity ?: return
        host.runOnUiThread {
            if (activity !== host || host.isFinishing || host.isDestroyed) return@runOnUiThread
            if (accountToken == null || adFree == true) {
                dispatch(attemptId, false)
                return@runOnUiThread
            }
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
        val host = activity ?: return false
        if (host.isFinishing || host.isDestroyed || adFree == true) return false
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
            ad.show(host)
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
        val host = activity ?: return
        val target = webView ?: return
        host.runOnUiThread {
            if (activity !== host || webView !== target ||
                host.isFinishing || host.isDestroyed) return@runOnUiThread
            val js = "window.dispatchEvent(new CustomEvent('echo:native-rewarded-result'," +
                "{detail:{attemptId:" + JSONObject.quote(id) + ",watched:" + watched + "}}))"
            target.evaluateJavascript(js, null)
        }
    }
}
