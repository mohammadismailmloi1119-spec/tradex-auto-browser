/*
 * KioskWebViewManager — configures and manages the single WebView instance.
 * Handles all page lifecycle, extension integration, network monitoring, and crash recovery.
 */

package com.kioskbrowser.webview

import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
import com.kioskbrowser.AppConfig
import com.kioskbrowser.BuildConfig
import com.kioskbrowser.KioskApplication
import com.kioskbrowser.extension.ExtensionLoader
import android.content.Intent as AndroidIntent
import com.kioskbrowser.extension.bridge.AlarmReceiver
import com.kioskbrowser.extension.bridge.ExtensionBridge
import com.kioskbrowser.extension.bridge.ExtensionEventDispatcher
import com.kioskbrowser.extension.bridge.ExtensionInjectionManager
import com.kioskbrowser.ui.ExtensionLauncherActivity
import kotlinx.coroutines.*

class KioskWebViewManager(
    private val activity: Activity,
    private val container: FrameLayout,
    private val extensionLoader: ExtensionLoader
) {
    companion object {
        private const val TAG = "KioskWebViewMgr"
        private const val RENDERER_CRASH_DELAY = 1500L
    }

    var webView: WebView? = null; private set
    var isOnline: Boolean = true; private set
    var isLoading: Boolean = false; private set

    var onPageStarted: (() -> Unit)? = null
    var onPageFinished: (() -> Unit)? = null
    var onProgressChanged: ((Int) -> Unit)? = null
    var onError: ((Int, String, String?) -> Unit)? = null
    var onOfflineChanged: ((Boolean) -> Unit)? = null

    private val dispatcher = ExtensionEventDispatcher()
    private lateinit var bridge: ExtensionBridge
    private lateinit var injectionManager: ExtensionInjectionManager
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val handler = Handler(Looper.getMainLooper())
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var alarmReceiver: BroadcastReceiver? = null

    @SuppressLint("SetJavaScriptEnabled")
    fun initialize() {
        Log.d(TAG, "Initializing WebView manager")
        bridge = ExtensionBridge(activity, extensionLoader, dispatcher)
        injectionManager = ExtensionInjectionManager(extensionLoader, bridge, dispatcher)
        val wv = WebView(activity).apply { layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
        webView = wv; dispatcher.webView = wv
        configureWebView(wv); configureWebViewClient(wv); configureWebChromeClient(wv); addExtensionBridge(wv)
        container.addView(wv)
        registerNetworkCallback(); registerAlarmReceiver()
        Log.d(TAG, "WebView manager initialized")
    }

    fun loadUrl() { webView?.loadUrl(AppConfig.FIXED_WEBSITE_URL) }
    fun reload() { if (isOnline) webView?.reload() else loadUrl() }

    /**
     * Fire webNavigation.onCommitted / onCompleted events so the extension's
     * anti-block logic in background.js can detect page loads.
     */
    private fun fireWebNavigationEvent(wv: WebView, url: String) {
        val js = """
(function(){
  if (chrome && chrome.webNavigation) {
    var ev = { frameId: 0, parentFrameId: -1, tabId: 1, url: 'URL_PLACEHOLDER', timeStamp: Date.now(), transitionType: 'link', transitionQualifiers: [] };
    if (chrome.webNavigation.onCommitted && chrome.webNavigation.onCommitted._l) {
      chrome.webNavigation.onCommitted._l.forEach(function(fn) { try { fn(ev); } catch(e) {} });
    }
  }
})();
""".replace("URL_PLACEHOLDER", url.replace("'", "\\'"))
        wv.evaluateJavascript(js, null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(wv: WebView) {
        val settings = wv.settings; val ramTier = KioskApplication.ramTier
        settings.javaScriptEnabled = true; settings.domStorageEnabled = true; settings.databaseEnabled = true
        settings.useWideViewPort = true; settings.loadWithOverviewMode = true
        settings.setSupportZoom(false); settings.builtInZoomControls = false; settings.displayZoomControls = false
        wv.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null)
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.databasePath = activity.cacheDir.absolutePath + "/webview_db"
        settings.allowFileAccess = false; settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false; settings.allowUniversalAccessFromFileURLs = false
        settings.loadsImagesAutomatically = true; settings.blockNetworkImage = false
        settings.mediaPlaybackRequiresUserGesture = false
        settings.javaScriptCanOpenWindowsAutomatically = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        if (AppConfig.SAFE_BROWSING_ENABLED && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WebView.startSafeBrowsing(activity) { Log.d(TAG, "SafeBrowsing: $it") }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(wv, AppConfig.THIRD_PARTY_COOKIES_ENABLED) }
        if (AppConfig.CUSTOM_USER_AGENT_SUFFIX.isNotEmpty()) settings.userAgentString = settings.userAgentString + " " + AppConfig.CUSTOM_USER_AGENT_SUFFIX
        if (BuildConfig.DEBUG && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) WebView.setWebContentsDebuggingEnabled(true)
        Log.d(TAG, "WebView configured — tier=$ramTier")
    }

    private fun configureWebViewClient(wv: WebView) {
        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Allow all HTTP/HTTPS navigation — TRADEX AUTO needs to navigate
                // the WinGo game site freely. External URLs are not opened; they stay
                // within the WebView. The single-tab kiosk still applies.
                val scheme = request.url.scheme ?: ""
                if (scheme == "http" || scheme == "https") {
                    return false // Allow all HTTPS/HTTP URLs
                }
                // Block non-web schemes (intent://, market://, etc.)
                Log.w(TAG, "Blocked non-web URL scheme: ${request.url}")
                return true
            }
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                Log.d(TAG, "Page started: $url"); isLoading = true; onPageStarted?.invoke()
                injectionManager.injectContentScripts(view, url, "document_start"); injectionManager.injectApiShim(view)
            }
            override fun onPageFinished(view: WebView, url: String) {
                Log.d(TAG, "Page finished: $url"); isLoading = false; onPageFinished?.invoke()
                injectionManager.injectContentScripts(view, url, "document_end")
                injectionManager.injectContentScripts(view, url, "document_idle")
                injectionManager.injectBackgroundScript(view); dispatcher.flushCallbacks()

                // Fire webNavigation.onCommitted / onCompleted for extension anti-block logic
                fireWebNavigationEvent(view, url)
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true && error != null) { isLoading = false; onError?.invoke(error.errorCode, error.description?.toString() ?: "Unknown", request.url.toString()) }
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (request.isForMainFrame) { isLoading = false; onError?.invoke(errorResponse.statusCode, errorResponse.reasonPhrase ?: "HTTP Error", request.url.toString()) }
            }
            @Suppress("DEPRECATION")
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
                Log.e(TAG, "SSL error: ${error.primaryError}"); if (BuildConfig.DEBUG) handler.proceed() else { handler.cancel(); isLoading = false; onError?.invoke(error.primaryError, "SSL Error", error.url) }
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.e(TAG, "Render process gone! crash=${detail.didCrash()}"); isLoading = false
                if (detail.didCrash()) handler.postDelayed({ recoverFromRendererCrash() }, RENDERER_CRASH_DELAY) else handler.post { recoverFromRendererCrash() }
                return true
            }
        }
    }

    private fun configureWebChromeClient(wv: WebView) {
        wv.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, np: Int) { onProgressChanged?.invoke(np) }
            override fun onConsoleMessage(cm: ConsoleMessage?): Boolean { if (BuildConfig.DEBUG) Log.d(TAG, "JS: [${cm?.messageLevel()}] ${cm?.message()}"); return true }
            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean { result.cancel(); return true }
            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean { result.cancel(); return true }
            override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean { result.cancel(); return true }
        }
    }

    @SuppressLint("JavascriptInterface")
    private fun addExtensionBridge(wv: WebView) {
        wv.addJavascriptInterface(bridge, ExtensionBridge.INTERFACE_NAME)

        // Wire tabs.create → opens ExtensionLauncherActivity for TRADEX AUTO
        bridge.onOpenLauncher = {
            val intent = android.content.Intent(activity, com.kioskbrowser.ui.ExtensionLauncherActivity::class.java)
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            Log.d(TAG, "Launcher opened via tabs.create")
        }

        // Handle scripting.executeScript / insertCSS from background.js anti-block
        // Script injection listener

        wv.post { injectionManager.injectApiShim(wv) }
    }

    /**
     * Handle chrome.scripting.executeScript / insertCSS calls from the extension.
     * Reads extension files and injects them into the WebView.
     */
    private fun handleScriptingRequest(detailsJson: String, callbackId: String, wv: WebView) {
        try {
            val details = org.json.JSONObject(detailsJson)
            val filesArr = details.optJSONArray("files")
            val code = details.optString("code", "")
            val funcStr = details.optString("func", "")

            if (filesArr != null && filesArr.length() > 0) {
                val fileName = filesArr.getString(0)
                val extContent = extensionLoader.readExtensionFile(fileName)
                if (extContent != null) {
                    wv.post {
                        wv.evaluateJavascript("(function(){try{$extContent}catch(e){console.error('Script err:',e);}})();") { result ->
                            bridge.callCallback(callbackId, result ?: "null")
                        }
                    }
                    Log.d(TAG, "Injected extension file via scripting: $fileName")
                } else {
                    bridge.callCallback(callbackId, "null")
                }
            } else if (code.isNotBlank()) {
                wv.post {
                    wv.evaluateJavascript(code) { result -> bridge.callCallback(callbackId, result ?: "null") }
                }
            } else if (funcStr.isNotBlank()) {
                // The func is a serialized function — wrap it
                wv.post {
                    wv.evaluateJavascript("($funcStr)();") { result -> bridge.callCallback(callbackId, result ?: "null") }
                }
            } else {
                bridge.callCallback(callbackId, "null")
            }
        } catch (e: Exception) {
            Log.e(TAG, "scripting.executeScript error", e)
            bridge.callCallback(callbackId, "null")
        }
    }

    private fun registerNetworkCallback() {
        val cm = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { if (!isOnline) { isOnline = true; handler.post { onOfflineChanged?.invoke(false); reload() } } }
            override fun onLost(network: Network) { isOnline = false; handler.post { onOfflineChanged?.invoke(true) } }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                val hasNet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                if (isOnline != hasNet) { isOnline = hasNet; handler.post { onOfflineChanged?.invoke(!hasNet); if (hasNet) reload() } }
            }
        }
        cm.registerNetworkCallback(NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), networkCallback!!)
    }

    private fun registerAlarmReceiver() {
        alarmReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action == AlarmReceiver.ACTION_ALARM_FIRED) {
                    val name = intent.getStringExtra(AlarmReceiver.EXTRA_ALARM_NAME) ?: ""
                    webView?.post { webView?.evaluateJavascript("if(chrome&&chrome.alarms&&chrome.alarms.onAlarm){var l=chrome.alarms.onAlarm._l;if(l)for(var i=0;i<l.length;i++)l[i]({name:'$name'});}", null) }
                }
            }
        }
        activity.registerReceiver(alarmReceiver, IntentFilter(AlarmReceiver.ACTION_ALARM_FIRED), Context.RECEIVER_NOT_EXPORTED)
    }

    private fun recoverFromRendererCrash() {
        try {
            val old = webView ?: return; val parent = old.parent as? ViewGroup ?: return
            parent.removeView(old); old.destroy()
            val nwv = WebView(activity).apply { layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
            webView = nwv; dispatcher.webView = nwv
            configureWebView(nwv); configureWebViewClient(nwv); configureWebChromeClient(nwv); addExtensionBridge(nwv)
            parent.addView(nwv); loadUrl()
            Toast.makeText(activity, "Page recovered from crash", Toast.LENGTH_SHORT).show()
            Log.i(TAG, "Renderer crash recovered")
        } catch (e: Exception) { Log.e(TAG, "Crash recovery failed", e) }
    }

    fun trimMemory(level: Int) { if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) webView?.clearCache(true) }
    fun onResume() { webView?.onResume(); webView?.resumeTimers() }
    fun onPause() { webView?.onPause(); webView?.pauseTimers() }

    fun destroy() {
        networkCallback?.let { (activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it) }
        alarmReceiver?.let { try { activity.unregisterReceiver(it) } catch (e: Exception) {} }
        webView?.apply { stopLoading(); loadUrl("about:blank"); clearHistory(); (parent as? ViewGroup)?.removeView(this); destroy() }
        webView = null; dispatcher.clear(); scope.cancel(); Log.d(TAG, "WebView manager destroyed")
    }
}
