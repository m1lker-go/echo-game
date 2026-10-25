package ru.echo.game

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import android.util.Base64
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
            if (code !in 200..299) {
                val detail = runCatching { JSONObject(response) }.getOrNull()
                if (endpoint.startsWith("oauth/")) {
                    val detail = when (code) {
                        503 -> "Этот способ входа ещё не настроен для ECHO"
                        409 -> "Аккаунт провайдера уже привязан к другому игроку ECHO"
                        401, 403 -> "Подтверждение входа истекло или недействительно"
                        else -> "Ошибка авторизации через Google / Яндекс ($code)"
                    }
                    throw IllegalStateException(detail)
                }
                if (endpoint.startsWith("nickname")) {
                    val message = when {
                        code == 409 -> "Имя уже занято"
                        detail?.optString("code") == "forbidden" -> "Имя содержит запрещённые слова"
                        code == 400 -> "Имя: 3–20 букв, цифр, _ или -"
                        code == 401 || code == 403 -> "Сессия истекла. Войди в аккаунт заново."
                        else -> "Не удалось изменить имя (ошибка $code)"
                    }
                    throw IllegalStateException(message)
                }
                throw IllegalStateException(
                    when (code) {
                        400, 401, 403 -> "VK ID не подтвердил вход в ECHO ($code)"
                        404 -> "Сервер авторизации ECHO недоступен (404)"
                        else -> "Ошибка сервера ECHO ($code)"
                    }
                )
            }
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

    // Same validation and update endpoints as the browser's pencil action.
    // Called on a background thread; a successful response is the authority.
    fun changeNickname(token: String, value: String): String {
        require(TOKEN_PATTERN.matches(token)) { "Нужен вход в ECHO" }
        require(Regex("^[A-Za-zА-Яа-яЁё0-9_-]{3,20}$").matches(value)) {
            "Имя: 3–20 букв, цифр, _ или -"
        }
        val body = JSONObject().put("nickname", value).toString()
        request("POST", "nickname/validate", body = body, token = token)
        val response = request("POST", "nickname", body = body, token = token)
        return response.getString("nickname")
    }

    // Browser authorization with ECHO-server token exchange and PKCE.
    fun startOAuth(provider: String, link: Boolean): String {
        require(provider == "google" || provider == "yandex")
        val current = if (link) token() ?: throw IllegalStateException("Сначала войди в ECHO") else null
        val random = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val verifier = Base64.encodeToString(random, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val challenge = Base64.encodeToString(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        val body = JSONObject().put("platform", "android")
            .put("codeChallenge", challenge).put("link", link).toString()
        val answer = request("POST", "oauth/$provider/start", body, current)
        val next = answer.getString("authorizationUrl")
        require(next.startsWith(if (provider == "google")
            "https://accounts.google.com/" else "https://oauth.yandex.ru/")) {
            "Некорректный сервер авторизации"
        }
        preferences.edit().putString("oauth.verifier", verifier)
            .putLong("oauth.started", System.currentTimeMillis()).apply()
        return next
    }

    fun finishOAuth(ticket: String): EchoLoginResult {
        require(Regex("^[A-Za-z0-9_-]{43}$").matches(ticket)) { "Недействительный код входа" }
        val verifier = preferences.getString("oauth.verifier", null)
            ?: throw IllegalStateException("Вход не был начат на этом устройстве")
        val started = preferences.getLong("oauth.started", 0L)
        check(started > 0L && (System.currentTimeMillis() - started) in 0L..600000L) {
            "Подтверждение входа истекло"
        }
        val body = JSONObject().put("platform", "android")
            .put("ticket", ticket).put("codeVerifier", verifier).toString()
        val json = request("POST", "oauth/complete", body)
        val gameToken = json.getString("token")
        require(TOKEN_PATTERN.matches(gameToken)) { "Не удалось получить игровую сессию" }
        preferences.edit().remove("oauth.verifier").remove("oauth.started").apply()
        return EchoLoginResult(gameToken, json.optString("nickname").ifBlank { "Игрок ECHO" })
    }

    fun logoutServer(token: String) {
        runCatching { request("POST", "logout", body = "{}", token = token) }
    }
}
