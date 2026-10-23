package ru.echo.game

import android.graphics.Color as AndroidColor
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
                    onLogout = ::logoutEcho)
            }
        }
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
        if (::echoAudio.isInitialized) echoAudio.release()
        super.onDestroy()
    }
}

