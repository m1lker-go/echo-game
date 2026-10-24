package ru.echo.game

import android.graphics.Color as AndroidColor
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.widget.Toast
import android.webkit.WebStorage
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.material3.MaterialTheme
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.vk.id.VKID
import com.vk.id.AccessToken
import com.vk.id.auth.VKIDAuthCallback
import com.vk.id.VKIDAuthFail

internal enum class Page {
    HOME, HEROES, SHOP, QUESTS, SETTINGS,
    ARENA, HERO_VIEW, PACK_VIEW, ACCOUNT, CODE_VIEW
}

class MainActivity : ComponentActivity() {
    private lateinit var echoAudio: EchoAudioEngine
    private lateinit var echoAuth: EchoAuthSession
    private var vkLoginInProgress = false
    private var networkUnavailable by mutableStateOf(false)
    private var connectivity: EchoConnectivityMonitor? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        echoAudio = EchoAudioEngine(applicationContext)
        echoAuth = EchoAuthSession(applicationContext)
        echoAuth.token()?.let { previous ->
            Thread {
                runCatching { echoAuth.checkSession(previous) }
                    .onSuccess { freshName ->
                        if (freshName.isNotBlank()) runOnUiThread {
                            if (echoAuth.token() == previous) echoAuth.updateNickname(freshName)
                        }
                    }
                    .onFailure { error ->
                        // Clear only a verified 401; offline or server 5xx must not
                        // silently sign out users from the native app.
                        if (error is EchoSessionExpired) runOnUiThread {
                            if (echoAuth.token() == previous) echoAuth.clearSession()
                        }
                    }
            }.start()
        }
        window.setBackgroundDrawable(ColorDrawable(AndroidColor.BLACK))
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        setContent {
            MaterialTheme {
                EchoAndroidShell(echoAudio, echoAuth, onVkLogin = ::startVkLogin,
                    onLogout = ::logoutEcho, onDeleteAccount = ::deleteEchoAccount)
                if (networkUnavailable) {
                    val english = echoAudio.language == "en"
                    EchoConfirmDialog(
                        title = if (english) "CONNECTION LOST" else "СОЕДИНЕНИЕ ПОТЕРЯНО",
                        message = if (english)
                            "No internet connection. Check your network and try again."
                        else "Нет подключения к интернету. Проверь сеть и попробуй снова.",
                        cancelLabel = null,
                        confirmLabel = if (english) "TRY AGAIN" else "ПОПРОБОВАТЬ СНОВА",
                        onDismiss = {},
                        onConfirm = { networkUnavailable = connectivity?.isOnline() != true }
                    )
                }
            }
        }
        connectivity = EchoConnectivityMonitor(this) { online ->
            networkUnavailable = !online
        }.also { it.start() }
    }


    private fun startVkLogin() {
        if (vkLoginInProgress || echoAuth.busy) return
        if (!BuildConfig.ECHO_VK_CONFIGURED) {
            echoAuth.message = "Для входа VK настрой ECHO_VK_CLIENT_SECRET в Android Studio (не ключ Cat Fighting)."
            return
        }
        vkLoginInProgress = true
        echoAuth.busy = true
        echoAuth.message = null
        try {
            VKID.instance.authorize(this, vkAuthCallback)
        } catch (error: Exception) {
            vkLoginInProgress = false
            echoAuth.busy = false
            echoAuth.message = "VK ID не запустился: " + (error.message ?: "ошибка")
            Log.e("EchoVKID", "VK ID authorize failed", error)
        }
    }

    private val vkAuthCallback = object : VKIDAuthCallback {
        override fun onAuth(accessToken: AccessToken) {
            // Unlike Web VK ID widget, the native SDK calls back to the Activity,
            // not to the ordinary browser at https://cat-fight.ru/echo/.
            val vkToken = accessToken.token
            Thread {
                val result = runCatching { echoAuth.exchangeVkToken(vkToken) }
                runOnUiThread {
                    vkLoginInProgress = false
                    echoAuth.busy = false
                    result.onSuccess {
                        echoAuth.accept(it)
                        Toast.makeText(this@MainActivity, "Вы вошли в ECHO", Toast.LENGTH_SHORT).show()
                    }.onFailure {
                        echoAuth.message = it.message ?: "Не удалось войти в ECHO через VK"
                        Log.e("EchoVKID", "ECHO session exchange failed (no tokens logged)", it)
                    }
                }
            }.start()
        }

        override fun onFail(fail: VKIDAuthFail) {
            vkLoginInProgress = false
            echoAuth.busy = false
            echoAuth.message = "Вход через VK отменён или не выполнен"
        }
    }

    private fun deleteEchoAccount() {
        val existing = echoAuth.token() ?: run {
            echoAuth.message = "Для удаления аккаунта войдите через VK"
            return
        }
        if (echoAuth.busy) return
        echoAuth.busy = true
        echoAuth.message = null
        Thread {
            val result = runCatching { echoAuth.deleteAccount(existing) }
            runOnUiThread {
                if (echoAuth.token() != existing) return@runOnUiThread
                echoAuth.busy = false
                result.onSuccess {
                    // All ECHO bearer sessions are now invalid on the server.
                    echoAuth.clearSession()
                    // Remove the previous account's WebView localStorage.
                    // Other Android app data and sound/language preferences stay intact.
                    WebStorage.getInstance().deleteOrigin("https://cat-fight.ru")
                    getSharedPreferences("echo.android.battle-entries", MODE_PRIVATE)
                        .edit().clear().apply()
                    Toast.makeText(this@MainActivity, "Аккаунт ЭХО удалён", Toast.LENGTH_LONG).show()
                }.onFailure { error ->
                    // Never erase a local session without server confirmation.
                    echoAuth.message = "Не удалось удалить аккаунт: " +
                        (error.message ?: "проверь соединение")
                    Log.e("EchoAccountDeletion", "Account deletion request failed", error)
                }
            }
        }.start()
    }

    private fun logoutEcho() {
        val existing = echoAuth.token()
        echoAuth.clearSession()
        if (existing != null) Thread { echoAuth.logoutServer(existing) }.start()
    }

    override fun onResume() {
        super.onResume()
        if (::echoAudio.isInitialized) echoAudio.setForeground(true)
    }

    override fun onPause() {
        if (::echoAudio.isInitialized) echoAudio.setForeground(false)
        super.onPause()
    }

    override fun onDestroy() {
        connectivity?.stop()
        connectivity = null
        if (::echoAudio.isInitialized) echoAudio.release()
        super.onDestroy()
    }
}

