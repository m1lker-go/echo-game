package ru.echo.game

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.util.Log

/** Android validated internet monitor shared by the native menu and WebView. */
internal class EchoConnectivityMonitor(
    context: Context,
    private val onChange: (online: Boolean) -> Unit
) {
    private val manager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val handler = Handler(Looper.getMainLooper())
    private var started = false
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = notifyChange()
        override fun onLost(network: Network) = notifyChange()
        override fun onCapabilitiesChanged(
            network: Network, capabilities: NetworkCapabilities
        ) = notifyChange()
        override fun onUnavailable() = notifyChange()
    }

    fun isOnline(): Boolean {
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    fun start() {
        if (started) return
        started = true
        try {
            manager.registerDefaultNetworkCallback(callback)
        } catch (error: RuntimeException) {
            Log.w("EchoConnectivity", "Network callback registration failed", error)
        }
        notifyChange()
    }

    fun stop() {
        if (!started) return
        started = false
        runCatching { manager.unregisterNetworkCallback(callback) }
        handler.removeCallbacksAndMessages(null)
    }

    private fun notifyChange() {
        handler.post { if (started) onChange(isOnline()) }
    }
}
