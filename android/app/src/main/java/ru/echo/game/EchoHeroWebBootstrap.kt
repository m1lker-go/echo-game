package ru.echo.game

import android.util.Log
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Protect the previously selected hero before ECHO menu.js and game.js run.
 * Live menu.js temporarily treats unlocked heroes as locked until the async
 * /echo/api/heroes result arrives. Its early fallback otherwise overwrites
 * localStorage for the next WebView (especially when launching the arena).
 */
internal object EchoHeroWebBootstrap {
    private const val TAG = "EchoWebView"
    private val origins = setOf("https://cat-fight.ru")

    fun install(webView: WebView, auth: EchoAuthSession): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.w(TAG, "Document-start script unsupported; using legacy session bootstrap")
            return false
        }

        val sessionToken = auth.token()
        val script = """
            (function(){
              'use strict';
              if (location.pathname !== '/echo/' && location.pathname !== '/echo') return;
              try {
                const storage = window.localStorage;
                const session = __ECHO_TOKEN_LITERAL__;
                const shouldClear = __ECHO_LOGOUT_FLAG__;
                if (session) storage.setItem('echo.authToken', session);
                else if (shouldClear) {
                  storage.removeItem('echo.authToken');
                  storage.removeItem('echo.selectedModel');
                }

                const key = 'echo.selectedModel';
                const validModel = value =>
                  /^character-(?:female-[a-f]|male-[a-f]|ghost|keeper|skeleton|zombie|human|orc)\.glb$/.test(value || '');
                let preferred = storage.getItem(key);
                if (!session || !validModel(preferred)) preferred = null;
                let userClicked = null;
                document.addEventListener('click', event => {
                  const target = event.target;
                  const card = target && target.closest && target.closest('#character-grid [data-model]');
                  if (!card || card.getAttribute('aria-disabled') === 'true') return;
                  const selected = card.getAttribute('data-model');
                  if (validModel(selected)) {
                    userClicked = selected;
                    setTimeout(() => {
                      if (userClicked === selected) userClicked = null;
                    }, 0);
                  }
                }, true);
                const nativeSet = Storage.prototype.setItem;
                Storage.prototype.setItem = function(k, val) {
                  if (this === storage && k === key) {
                    const next = String(val);
                    if (preferred && next !== preferred && next !== userClicked) {
                      return;
                    }
                    if (validModel(next)) preferred = next;
                  }
                  return nativeSet.apply(this, arguments);
                };
              } catch (error) {
                console.warn('[echo android] hero startup restore unavailable');
              }
            })();
        """.trimIndent()
            .replace("__ECHO_TOKEN_LITERAL__", sessionToken?.let { JSONObject.quote(it) } ?: "null")
            .replace("__ECHO_LOGOUT_FLAG__", auth.clearWebSession.toString())

        return runCatching {
            WebViewCompat.addDocumentStartJavaScript(webView, script, origins)
            Log.i(TAG, "ECHO hero selection protected before game JS initialization")
            true
        }.getOrElse {
            Log.w(TAG, "Document-start hero bridge unavailable", it)
            false
        }
    }
}
