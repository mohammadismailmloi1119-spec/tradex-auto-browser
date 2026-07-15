/*
 * KioskApplication — Custom Application subclass.
 * Detects device RAM tier, pre-warms WebView, sets up global state.
 */

package com.kioskbrowser

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.StrictMode
import android.util.Log
import android.webkit.WebView

class KioskApplication : Application() {

    companion object {
        private const val TAG = "KioskApplication"

        @Volatile
        private var instance: KioskApplication? = null

        fun getInstance(): KioskApplication = instance!!

        enum class RamTier { LOW, MID, HIGH }

        @Volatile
        var ramTier: RamTier = RamTier.MID
            private set

        @Volatile
        var totalRamMb: Long = 0L
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        detectRamTier()
        configureStrictMode()
        preWarmWebView()
        Log.i(TAG, "KioskBrowser starting — RAM tier: $ramTier (${totalRamMb} MB)")
    }

    private fun detectRamTier() {
        val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memInfo)
        totalRamMb = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            memInfo.totalMem / (1024 * 1024)
        } else {
            @Suppress("DEPRECATION")
            memInfo.availMem / (1024 * 1024)
        }
        ramTier = when {
            totalRamMb >= AppConfig.HIGH_RAM_THRESHOLD_MB -> RamTier.HIGH
            totalRamMb < AppConfig.LOW_RAM_THRESHOLD_MB -> RamTier.LOW
            else -> RamTier.MID
        }
    }

    private fun configureStrictMode() {
        if (BuildConfig.DEBUG) {
            StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().build())
            StrictMode.setVmPolicy(StrictMode.VmPolicy.Builder().detectLeakedSqlLiteObjects().detectLeakedClosableObjects().penaltyLog().build())
        }
    }

    private fun preWarmWebView() {
        Thread {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    android.webkit.WebView.startSafeBrowsing(this) { success ->
                        Log.d(TAG, "SafeBrowsing init: $success")
                    }
                }
                WebView(applicationContext).destroy()
            } catch (e: Exception) {
                Log.w(TAG, "WebView pre-warm failed (non-fatal): ${e.message}")
            }
        }.apply { name = "WebViewPreWarm"; priority = Thread.MIN_PRIORITY; start() }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        Log.d(TAG, "onTrimMemory level=$level")
    }
}
