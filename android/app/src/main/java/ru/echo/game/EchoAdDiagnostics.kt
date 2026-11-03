package ru.echo.game

import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.my.target.common.MyTargetVersion
import com.my.target.common.models.IAdLoadingError
import java.util.concurrent.atomic.AtomicInteger

/**
 * On-device VK/myTarget diagnostics. Opt in only for a locally signed
 * diagnostic build (-PECHO_AD_DIAGNOSTICS=true); off in public APKs.
 * Never log auth tokens, advertising IDs, IPs, or raw ad responses.
 */
internal object EchoAdDiagnostics {
    private const val TAG = "EchoAdDiag"
    private val nextId = AtomicInteger(0)
    val enabled: Boolean get() = BuildConfig.ECHO_AD_DIAGNOSTICS

    fun initialize() {
        if (!enabled) return
        // The SDK exposes MyTargetManager.setDebugMode(true). Resolve it
        // defensively to avoid a hard dependency on an internal package path.
        val candidates = listOf(
            "com.my.target.common.MyTargetManager",
            "com.my.target.MyTargetManager"
        )
        var lastError: Throwable? = null
        var configured = false
        for (className in candidates) {
            try {
                val cls = Class.forName(className)
                val method = cls.getMethod("setDebugMode", Boolean::class.javaPrimitiveType)
                method.invoke(null, true)
                configured = true
                break
            } catch (error: ReflectiveOperationException) {
                lastError = error
            }
        }
        if (configured) Log.i(TAG, "myTarget SDK verbose logging ENABLED")
        else Log.w(TAG, "Could not enable myTarget SDK verbose logging", lastError)
        Log.i(TAG, "Diagnostic APK version=${BuildConfig.VERSION_NAME} " +
            "sdk=${MyTargetVersion.VERSION} androidApi=${Build.VERSION.SDK_INT} " +
            "package=${BuildConfig.APPLICATION_ID}; no test-device override")
    }

    class Trace(private val format: String, private val slot: Int) {
        private val id = nextId.incrementAndGet()
        private val started = SystemClock.elapsedRealtime()

        init { event("request", "load will be started") }

        private fun prefix(stage: String): String =
            "id=$id format=$format slot=$slot stage=$stage " +
                "elapsedMs=${SystemClock.elapsedRealtime() - started}"

        fun event(stage: String, details: String = "") {
            if (enabled) Log.i(TAG, prefix(stage) + if (details.isEmpty()) "" else " $details")
        }

        fun noAd(error: IAdLoadingError) {
            if (!enabled) return
            // SDK error codes were added in SDK 5.18. Use only the public
            // zero-argument getCode method when present; don't dump internals.
            val code = runCatching {
                error.javaClass.methods.firstOrNull {
                    it.name == "getCode" && it.parameterCount == 0
                }?.invoke(error)?.toString()
            }.getOrNull() ?: "not_exposed"
            val message = error.message.take(500).replace('\n', ' ')
            Log.w(TAG, prefix("onNoAd") +
                " code=$code type=${error.javaClass.simpleName} message=$message")
        }

        fun failure(stage: String, error: Throwable) {
            if (enabled) Log.e(TAG, prefix(stage) + " exception", error)
        }
    }
}
