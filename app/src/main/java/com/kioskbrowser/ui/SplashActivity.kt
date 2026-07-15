/*
 * SplashActivity — displays the app launch splash screen.
 *
 * Flow:
 *   1. Show splash for SPLASH_MIN_DURATION_MS
 *   2. Load the extension in the background
 *   3. Transition to MainActivity
 */

package com.kioskbrowser.ui

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import com.kioskbrowser.AppConfig
import com.kioskbrowser.R
import com.kioskbrowser.extension.ExtensionLoader
import kotlinx.coroutines.*

class SplashActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "SplashActivity"
    }

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val handler = Handler(Looper.getMainLooper())
    private var startTime: Long = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)

        startTime = System.currentTimeMillis()

        // If we get launched with an intent URL (chrome-extension://), forward to MainActivity
        if (intent?.data != null && intent.data?.scheme == "chrome-extension") {
            proceedToMain()
            return
        }

        // Load extension and then proceed
        loadExtensionAndProceed()
    }

    private fun loadExtensionAndProceed() {
        scope.launch {
            val extLoader = ExtensionLoader(this@SplashActivity)

            // Load extension with timeout
            val loadResult = withTimeoutOrNull(AppConfig.EXTENSION_INIT_TIMEOUT_MS) {
                withContext(Dispatchers.IO) {
                    extLoader.load()
                }
            }

            if (loadResult != true) {
                Log.w(TAG, "Extension did not load successfully: ${extLoader.lastError}")
                // Proceed anyway — the browser works without the extension
            }

            // Wait for minimum splash duration
            val elapsed = System.currentTimeMillis() - startTime
            val remaining = AppConfig.SPLASH_MIN_DURATION_MS - elapsed
            if (remaining > 0) {
                delay(remaining)
            }

            proceedToMain()
        }
    }

    private fun proceedToMain() {
        val intent = Intent(this, MainActivity::class.java).apply {
            // Forward any data from the launch intent
            this@SplashActivity.intent?.data?.let { data = it }
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        startActivity(intent)
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        finish()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
