package ru.echo.game

import android.app.Activity
import android.util.Log
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * Server-verified entitlement check BEFORE the native interstitial request.
 * Never trust a WebView preference or accept an unauthenticated premium flag.
 * null = temporary network/server failure; don't punish paid users with ads.
 */
internal object EchoAdFreeAccess {
    private const val TAG = "EchoAdFreeAccess"
    private const val ENDPOINT = "https://cat-fight.ru/echo/api/ad-free/status"

    fun check(activity: Activity, token: String, done: (Boolean?) -> Unit) {
        Thread {
            var result: Boolean? = null
            var connection: HttpsURLConnection? = null
            try {
                connection = URL(ENDPOINT).openConnection() as HttpsURLConnection
                connection.requestMethod = "GET"
                connection.connectTimeout = 2500
                connection.readTimeout = 2500
                connection.useCaches = false
                connection.setRequestProperty("Authorization", "Bearer $token")
                if (connection.responseCode == 200) {
                    result = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                        .optBoolean("active", false)
                } else if (connection.responseCode == 401) {
                    result = false
                }
            } catch (error: Exception) {
                Log.w(TAG, "Entitlement status temporarily unavailable: " + error.javaClass.simpleName)
            } finally {
                connection?.disconnect()
            }
            activity.runOnUiThread { done(result) }
        }.start()
    }
}
