/*
 * MainActivity — the kiosk browser activity.
 *
 * This is the only visible activity after the splash screen.
 * It hosts the WebView in full-screen mode with a progress bar
 * and an offline indicator. No address bar, no tabs, no navigation.
 */

package com.kioskbrowser.ui

import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.kioskbrowser.AppConfig
import com.kioskbrowser.KioskApplication
import com.kioskbrowser.R
import com.kioskbrowser.extension.ExtensionLoader
import com.kioskbrowser.extension.bridge.AlarmReceiver
import com.kioskbrowser.webview.KioskWebViewManager
import kotlinx.coroutines.*

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
    }

    // ─────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────

    private lateinit var progressBar: ProgressBar
    private lateinit var offlineContainer: View
    private lateinit var offlineText: TextView
    private lateinit var retryButton: View

    // ─────────────────────────────────────────────────
    //  Core
    // ─────────────────────────────────────────────────

    private lateinit var webViewManager: KioskWebViewManager
    private lateinit var extensionLoader: ExtensionLoader

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val handler = Handler(Looper.getMainLooper())

    private var memoryTrimRunnable: Runnable? = null

    // ─────────────────────────────────────────────────
    //  Lifecycle
    // ─────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Bind views
        progressBar = findViewById(R.id.progress_bar)
        offlineContainer = findViewById(R.id.offline_container)
        offlineText = findViewById(R.id.offline_text)
        retryButton = findViewById(R.id.offline_retry_button)

        // Set up full-screen immersive mode
        enableFullScreen()

        // Initialize extension loader (carried forward from Splash)
        extensionLoader = ExtensionLoader(this)

        // Initialize WebView
        val webViewContainer = findViewById<android.widget.FrameLayout>(R.id.webview_container)
        webViewManager = KioskWebViewManager(this, webViewContainer, extensionLoader)
        setupCallbacks()

        // Reload extension if needed (Splash may have loaded it, but in cold-start it's fresh)
        scope.launch {
            if (!extensionLoader.isLoaded) {
                extensionLoader.load()
            }
            webViewManager.initialize()
            checkConnectivityAndLoad()
        }

        // Start periodic memory trimming for long-running sessions
        scheduleMemoryTrim()

        Log.d(TAG, "MainActivity created")
    }

    override fun onResume() {
        super.onResume()
        webViewManager.onResume()
    }

    override fun onPause() {
        super.onPause()
        webViewManager.onPause()
    }

    override fun onDestroy() {
        memoryTrimRunnable?.let { handler.removeCallbacks(it) }
        webViewManager.destroy()
        scope.cancel()
        super.onDestroy()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        webViewManager.trimMemory(level)
    }

    override fun onBackPressed() {
        // Kiosk mode: do nothing on back press.
        // The user cannot navigate away from the fixed website.
        // If we want to allow WebView back navigation within the fixed site:
        val wv = webViewManager.webView
        if (wv != null && wv.canGoBack()) {
            wv.goBack()
        }
        // Otherwise, back is disabled — keep user on the page.
    }

    // ─────────────────────────────────────────────────
    //  Full-Screen
    // ─────────────────────────────────────────────────

    private fun enableFullScreen() {
        // Hide system UI
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        // Keep screen on for kiosk mode (optional — can be configurable)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Handle cutout (notch) areas
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
    }

    // ─────────────────────────────────────────────────
    //  Callbacks
    // ─────────────────────────────────────────────────

    private fun setupCallbacks() {
        webViewManager.onProgressChanged = { progress ->
            progressBar.progress = progress
            if (progress >= 100) {
                progressBar.visibility = View.GONE
            } else {
                progressBar.visibility = View.VISIBLE
            }
        }

        webViewManager.onPageStarted = {
            progressBar.visibility = View.VISIBLE
            progressBar.progress = 0
            hideOffline()
        }

        webViewManager.onPageFinished = {
            progressBar.visibility = View.GONE
            hideOffline()
        }

        webViewManager.onError = { code, description, url ->
            progressBar.visibility = View.GONE
            Log.e(TAG, "Page error: $code - $description")
            if (!webViewManager.isOnline) {
                showOffline()
            }
            // For HTTP/SSL errors, the WebView already shows its error page
        }

        webViewManager.onOfflineChanged = { offline ->
            if (offline) {
                showOffline()
            } else {
                hideOffline()
                // Auto-retry
                handler.postDelayed({
                    webViewManager.reload()
                }, 500)
            }
        }

        retryButton.setOnClickListener {
            if (isNetworkAvailable()) {
                webViewManager.reload()
                hideOffline()
            } else {
                Toast.makeText(this, R.string.no_internet, Toast.LENGTH_SHORT).show()
            }
        }
    }

    // ─────────────────────────────────────────────────
    //  Connectivity
    // ─────────────────────────────────────────────────

    private fun checkConnectivityAndLoad() {
        if (isNetworkAvailable()) {
            webViewManager.loadUrl()
            hideOffline()
        } else {
            showOffline()
        }
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return false
        val capabilities = cm.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    // ─────────────────────────────────────────────────
    //  Offline UI
    // ─────────────────────────────────────────────────

    private fun showOffline() {
        offlineContainer.visibility = View.VISIBLE
    }

    private fun hideOffline() {
        offlineContainer.visibility = View.GONE
    }

    // ─────────────────────────────────────────────────
    //  Memory Management
    // ─────────────────────────────────────────────────

    private fun scheduleMemoryTrim() {
        if (AppConfig.MEMORY_TRIM_INTERVAL_MS <= 0) return

        memoryTrimRunnable = object : Runnable {
            override fun run() {
                // Trim WebView cache periodically to keep memory stable
                webViewManager.trimMemory(
                    ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE
                )
                handler.postDelayed(this, AppConfig.MEMORY_TRIM_INTERVAL_MS)
            }
        }
        handler.postDelayed(memoryTrimRunnable!!, AppConfig.MEMORY_TRIM_INTERVAL_MS)
    }

    // ─────────────────────────────────────────────────
    //  Intent Handling (chrome-extension://)
    // ─────────────────────────────────────────────────

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.data?.let { uri ->
            if (uri.scheme == "chrome-extension") {
                Log.d(TAG, "Extension URL: $uri")
                // Handle extension page requests
                val path = uri.path ?: ""
                if (path == "/popup.html" || path.contains("popup")) {
                    startActivity(Intent(this, ExtensionPopupActivity::class.java))
                }
            }
        }
    }
}
