package ru.echo.game

import android.app.Application
import com.vk.id.VKID

class EchoApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.ECHO_AD_DIAGNOSTICS) {
            // Diagnostic logging only; do not change the original 1.0.4 ad calls.
            val candidates = listOf("com.my.target.common.MyTargetManager", "com.my.target.MyTargetManager")
            val success = candidates.any { className ->
                runCatching {
                    Class.forName(className).getMethod("setDebugMode", Boolean::class.javaPrimitiveType)
                        .invoke(null, true)
                    true
                }.getOrDefault(false)
            }
            android.util.Log.i("EchoAdDiag", "Control APK version=${BuildConfig.VERSION_NAME} " +
                "sdk=${com.my.target.common.MyTargetVersion.VERSION} package=${BuildConfig.APPLICATION_ID}; " +
                "myTargetDebugEnabled=$success; original 1.0.4 ad logic")
        }
        // VK ID is initialized only after ECHO's own SDK client key is configured.
        if (BuildConfig.ECHO_VK_CONFIGURED) {
            VKID.init(this)
        }
    }
}
