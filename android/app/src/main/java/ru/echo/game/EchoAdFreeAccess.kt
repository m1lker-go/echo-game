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

/** The native shop must never buy a character pack when opening ad-free checkout. */
internal class EchoAdFreeAlreadyPurchased : IllegalStateException("Ad-free already purchased")
internal class EchoAdFreeSignInRequired : IllegalStateException("ECHO session expired")

internal object EchoAdFreeAccess {
    private const val TAG = "EchoAdFreeAccess"
    private const val ENDPOINT = "https://cat-fight.ru/echo/api/ad-free/status"

    /**
     * Start the one-time Robokassa checkout for the authenticated ECHO account.
     * Called ONLY on a worker thread. The server chooses the price and signs the
     * checkout URL; the Android client merely validates and opens that URL.
     */
    fun createRobokassaCheckout(token: String): String {
        require(Regex("^[a-f0-9]{64}$").matches(token)) { "Invalid ECHO session" }
        val endpoint = "https://cat-fight.ru/echo/api/payments/robokassa/create-ad-free"
        val connection = URL(endpoint).openConnection() as HttpsURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 8000
        connection.readTimeout = 8000
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.doOutput = true
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Content-Type", "application/json")
        return try {
            connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            if (code == 409) throw EchoAdFreeAlreadyPurchased()
            if (code == 401) throw EchoAdFreeSignInRequired()
            if (code != 200) throw IllegalStateException("ECHO checkout HTTP $code")

            val response = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val checkoutUrl = java.net.URI(response.getString("checkoutUrl"))
            val invoice = response.optString("orderId")
            require(
                checkoutUrl.scheme == "https" &&
                    checkoutUrl.host == "auth.robokassa.ru" &&
                    checkoutUrl.path == "/Merchant/Index.aspx" &&
                    checkoutUrl.userInfo == null &&
                    checkoutUrl.port == -1 &&
                    checkoutUrl.rawQuery != null &&
                    Regex("^[1-9]\\d{0,17}$").matches(invoice) &&
                    response.optDouble("price") == 490.0
            ) { "Invalid Robokassa checkout response" }
            checkoutUrl.toASCIIString()
        } finally {
            connection.disconnect()
        }
    }

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
