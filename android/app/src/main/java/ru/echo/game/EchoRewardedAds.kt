package ru.echo.game

import android.app.Activity
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.my.target.ads.Reward
import com.my.target.ads.RewardedAd
import com.my.target.common.models.IAdLoadingError
import org.json.JSONObject

/**
 * Rewarded video using the official VK Ads / myTarget Android SDK.
 * Attaches only to the trusted ECHO Quests WebView.
 * Success is dispatched only by RewardedAd.onReward, not by dismiss.
 */
internal class EchoRewardedAds(
    private val activity: Activity,
    private val webView: WebView
) {
    private companion object {
        const val TAG = "EchoRewardedAds"
        const val PLACEMENT_ID = 2096987
        val VALID_REQUEST = Regex("^[a-fA-F0-9-]{36}$")
    }

    private var ad: RewardedAd? = null
    private var requestId: String? = null
    private var delivered = false

    @JavascriptInterface
    fun showRewardedVideo(attemptId: String) {
        if (!VALID_REQUEST.matches(attemptId)) return
        activity.runOnUiThread {
            if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
            if (requestId != null) {
                dispatch(attemptId, false)
                return@runOnUiThread
            }
            requestId = attemptId
            delivered = false
            val rewarded = RewardedAd(PLACEMENT_ID, activity)
            ad = rewarded
            rewarded.listener = object : RewardedAd.RewardedAdListener {
                override fun onLoad(rewardedAd: RewardedAd) {
                    if (requestId == attemptId && !activity.isFinishing) {
                        rewardedAd.show()
                    }
                }
                override fun onNoAd(error: IAdLoadingError, rewardedAd: RewardedAd) {
                    Log.w(TAG, "Rewarded video unavailable: " + error.message)
                    closeAttempt()
                }
                override fun onDisplay(rewardedAd: RewardedAd) = Unit
                override fun onClick(rewardedAd: RewardedAd) = Unit
                override fun onFailedToShow(rewardedAd: RewardedAd) {
                    Log.w(TAG, "Rewarded video failed to display")
                    closeAttempt()
                }
                override fun onReward(reward: Reward, rewardedAd: RewardedAd) {
                    if (requestId == attemptId && !delivered) {
                        delivered = true
                        dispatch(attemptId, true)
                    }
                }
                override fun onDismiss(rewardedAd: RewardedAd) {
                    closeAttempt()
                }
            }
            rewarded.load()
        }
    }

    private fun closeAttempt() {
        val pending = requestId ?: return
        if (!delivered) {
            delivered = true
            dispatch(pending, false)
        }
        requestId = null
        ad = null
    }

    private fun dispatch(id: String, watched: Boolean) {
        // WebView.evaluateJavascript always executes on Android's UI thread.
        activity.runOnUiThread {
            if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
            val js = "window.dispatchEvent(new CustomEvent('echo:native-rewarded-result'," +
                "{detail:{attemptId:" + JSONObject.quote(id) + ",watched:" + watched + "}}))"
            webView.evaluateJavascript(js, null)
        }
    }

    fun destroy() {
        requestId = null
        ad?.dismiss()
        ad = null
    }
}
