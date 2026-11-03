package ru.echo.game

import android.app.Application
import com.vk.id.VKID

class EchoApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Enable VK SDK debug before the first ad request, only in opt-in builds.
        EchoAdDiagnostics.initialize()
        // VK ID is initialized only after ECHO's own SDK client key is configured.
        if (BuildConfig.ECHO_VK_CONFIGURED) {
            VKID.init(this)
        }
    }
}
