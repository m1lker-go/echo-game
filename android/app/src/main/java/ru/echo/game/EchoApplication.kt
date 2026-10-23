package ru.echo.game

import android.app.Application
import com.vk.id.VKID

class EchoApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // VK ID is initialized only after ECHO's own SDK client key is configured.
        if (BuildConfig.ECHO_VK_CONFIGURED) {
            VKID.init(this)
        }
    }
}
