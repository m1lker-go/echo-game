package ru.echo.game

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

private const val ECHO_AUTH_ENDPOINT = "https://cat-fight.ru/echo/api/auth/"
private val TOKEN_PATTERN = Regex("^[a-f0-9]{64}$")

internal class EchoSessionExpired : Exception("Сессия ECHO истекла")

internal data class EchoLoginResult(val token: String, val nickname: String)

internal class EchoAuthSession(context: Context) {
    private val preferences =
        context.getSharedPreferences("echo.android.auth", Context.MODE_PRIVATE)

    var nickname by mutableStateOf(preferences.getString("nickname", null))
        private set
    var busy by mutableStateOf(false)
    var message by mutableStateOf<String?>(null)
    var clearWebSession by mutableStateOf(preferences.getBoolean("clearWebSession", false))
        private set

    // Never place this bearer token in a URL, a log, a WebView callback URI or debug text.
    fun token(): String? = preferences.getString("token", null)?.takeIf { TOKEN_PATTERN.matches(it) }

    fun accept(result: EchoLoginResult) {
        require(TOKEN_PATTERN.matches(result.token))
        preferences.edit()
            .putString("token", result.token)
            .putString("nickname", result.nickname)
            .putBoolean("clearWebSession", false)
            .apply()
        nickname = result.nickname
        clearWebSession = false
        busy = false
        message = null
    }

    fun updateNickname(name: String) {
        if (token() == null || name.isBlank()) return
        preferences.edit().putString("nickname", name).apply()
        nickname = name
    }

    fun clearSession() {
        preferences.edit()
            .remove("token")
            .remove("nickname")
            .putBoolean("clearWebSession", true)
            .apply()
        nickname = null
        clearWebSession = true
        busy = false
        message = null
    }

    fun webSessionCleared() {
        preferences.edit().putBoolean("clearWebSession", false).apply()
        clearWebSession = false
    }

    private fun request(method: String, endpoint: String, body: String? = null, token: String? = null): JSONObject {
        val connection = (URL(ECHO_AUTH_ENDPOINT + endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 12000
            readTimeout = 12000
            useCaches = false
            setRequestProperty("Accept", "application/json")
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        return try {
            if (body != null) {
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            val response = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code == 401 && endpoint == "me") throw EchoSessionExpired()
            if (code !in 200..299) throw IllegalStateException(
                when (code) {
                    400, 401, 403 -> "VK ID не подтвердил вход в ECHO ($code)"
                    404 -> "Сервер авторизации ECHO недоступен (404)"
                    else -> "Ошибка сервера ECHO ($code)"
                }
            )
            JSONObject(response)
        } finally {
            connection.disconnect()
        }
    }

    // Called on a worker thread, never the Compose / Android main thread.
    fun exchangeVkToken(vkAccessToken: String): EchoLoginResult {
        require(vkAccessToken.length in 20..4096) { "Некорректный токен VK ID" }
        val body = JSONObject().put("accessToken", vkAccessToken).toString()
        val json = request("POST", "vk", body)
        val gameToken = json.optString("token")
        require(TOKEN_PATTERN.matches(gameToken)) { "Сервер ECHO не вернул сессию" }
        val nickname = json.optString("nickname").ifBlank { "Игрок ECHO" }
        return EchoLoginResult(gameToken, nickname)
    }

    // Called on a worker thread to prevent displaying an expired account.
    fun checkSession(token: String): String =
        request("GET", "me", token = token).optString("nickname")

    // Must run on a worker thread. Only the server response confirms deletion;
    // never revoke the local token merely because a request timed out.
    fun deleteAccount(token: String) {
        require(TOKEN_PATTERN.matches(token)) { "Нужен действующий вход в ECHO" }
        val confirmation = JSONObject().put("confirm", "DELETE").toString()
        val result = request("DELETE", "account", body = confirmation, token = token)
        check(result.optBoolean("ok", false)) { "Сервер не подтвердил удаление аккаунта" }
    }

    fun logoutServer(token: String) {
        runCatching { request("POST", "logout", body = "{}", token = token) }
    }
}
