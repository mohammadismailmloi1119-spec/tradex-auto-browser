/*
 * ExtensionBridge — JS-to-Native bridge for extension APIs.
 * Injected as "__kioskExtensionBridge" into WebView.
 *
 * TRADEX AUTO PRO specific support:
 *   - tabs.create() → opens ExtensionLauncherActivity for launcher.html
 *   - storage.local (SharedPreferences-backed, ~5MB)
 *   - runtime.sendMessage / onMessage for extension communication
 *   - webNavigation.onCommitted simulated via WebViewClient
 *   - scripting.executeScript / insertCSS
 *   - declarativeNetRequest (stub — rules.json applied via WebView)
 */

package com.kioskbrowser.extension.bridge

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.webkit.JavascriptInterface
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.kioskbrowser.AppConfig
import com.kioskbrowser.extension.ExtensionLoader
import com.kioskbrowser.ui.ExtensionLauncherActivity
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class ExtensionBridge(
    private val context: Context,
    private val extensionLoader: ExtensionLoader,
    private val eventDispatcher: ExtensionEventDispatcher
) {
    companion object {
        private const val TAG = "ExtensionBridge"
        const val INTERFACE_NAME = "__kioskExtensionBridge"
        private const val STORAGE_PREFS = "tradex_storage"  // dedicated prefs for TRADEX AUTO
        private const val NOTIFICATION_CHANNEL_ID = "tradex_notifications"
        private const val NOTIFICATION_CHANNEL_NAME = "TRADEX AUTO"
    }

    private val gson = Gson()
    private val storagePrefs: SharedPreferences = context.getSharedPreferences(STORAGE_PREFS, Context.MODE_PRIVATE)
    private val ports = ConcurrentHashMap<String, PortConnection>()
    private val alarms = ConcurrentHashMap<String, PendingIntent>()

    /** Callback from native when tabs.create is called to open the extension launcher. */
    var onOpenLauncher: (() -> Unit)? = null

    init { createNotificationChannel() }

    // ═══════════════════════════════════════════════════
    //  chrome.runtime
    // ═══════════════════════════════════════════════════

    @JavascriptInterface
    fun runtimeSendMessage(messageJson: String, callbackId: String) {
        val message = try { JSONObject(messageJson) } catch (e: Exception) { JSONObject().put("data", messageJson) }
        eventDispatcher.dispatchRuntimeMessage(message, callbackId)
    }

    @JavascriptInterface
    fun runtimeConnect(extensionId: String, connectInfoJson: String, callbackId: String) {
        val portId = UUID.randomUUID().toString()
        ports[portId] = PortConnection(extensionId, connectInfoJson, callbackId)
        eventDispatcher.onPortConnect(portId, callbackId)
    }

    @JavascriptInterface
    fun runtimeGetURL(path: String): String = "chrome-extension://${AppConfig.EXTENSION_ID}/$path"

    @JavascriptInterface
    fun runtimeGetManifest(): String = gson.toJson(extensionLoader.manifest)

    @JavascriptInterface
    fun runtimeGetPlatformInfo(callbackId: String) {
        val info = JSONObject().apply { put("os", "android"); put("arch", System.getProperty("os.arch") ?: "arm") }
        callCallback(callbackId, info.toString())
    }

    // ═══════════════════════════════════════════════════
    //  chrome.storage.local — backed by SharedPreferences
    // ═══════════════════════════════════════════════════

    @JavascriptInterface
    fun storageLocalGet(keysJson: String?): String {
        val allData = storagePrefs.all
        if (keysJson.isNullOrEmpty() || keysJson == "null") return gson.toJson(allData)
        return try {
            val keys: List<String> = gson.fromJson(keysJson, object : TypeToken<List<String>>() {}.type)
            val result = mutableMapOf<String, Any?>()
            keys.forEach { k -> allData[k]?.let { v -> result[k] = try { gson.fromJson(v.toString(), Any::class.java) } catch (e: Exception) { v } } }
            gson.toJson(result)
        } catch (e: Exception) {
            val value = allData[keysJson]
            gson.toJson(if (value != null) mapOf(keysJson to value) else mapOf(keysJson to null))
        }
    }

    @JavascriptInterface
    fun storageLocalSet(itemsJson: String) {
        try {
            val items: Map<String, Any> = gson.fromJson(itemsJson, object : TypeToken<Map<String, Any>>() {}.type)
            storagePrefs.edit().apply { items.forEach { (k, v) -> putString(k, gson.toJson(v)) }; apply() }
        } catch (e: Exception) { Log.e(TAG, "storage.local.set failed", e) }
    }

    @JavascriptInterface
    fun storageLocalRemove(keysJson: String) {
        try {
            val keys: List<String> = gson.fromJson(keysJson, object : TypeToken<List<String>>() {}.type)
            storagePrefs.edit().apply { keys.forEach { remove(it) }; apply() }
        } catch (e: Exception) { storagePrefs.edit().remove(keysJson).apply() }
    }

    @JavascriptInterface
    fun storageLocalClear() { storagePrefs.edit().clear().apply() }

    @JavascriptInterface
    fun storageLocalGetBytesInUse(keysJson: String?): String = gson.toJson(storagePrefs.all).length.toString()

    // ═══════════════════════════════════════════════════
    //  chrome.tabs — single-tab kiosk + launcher support
    // ═══════════════════════════════════════════════════

    @JavascriptInterface
    fun tabsQuery(queryInfoJson: String, callbackId: String) {
        val tab = JSONObject().apply {
            put("id", 1); put("index", 0); put("windowId", 1); put("active", true)
            put("status", "complete"); put("url", AppConfig.FIXED_WEBSITE_URL)
        }
        callCallback(callbackId, JSONArray().put(tab).toString())
    }

    @JavascriptInterface
    fun tabsGetCurrent(callbackId: String) {
        callCallback(callbackId, JSONObject().apply {
            put("id", 1); put("url", AppConfig.FIXED_WEBSITE_URL); put("active", true)
        }.toString())
    }

    /**
     * TRADEX AUTO uses tabs.create({ url: launcher }) to open the extension's
     * full-screen launcher.html panel. We handle this by opening
     * ExtensionLauncherActivity.
     */
    @JavascriptInterface
    fun tabsCreate(createPropertiesJson: String, callbackId: String) {
        try {
            val props = JSONObject(createPropertiesJson)
            val url = props.optString("url", "")
            Log.d(TAG, "tabs.create called with URL: $url")

            if (url.contains("launcher.html") || url.startsWith("chrome-extension://")) {
                // Open the extension launcher activity
                onOpenLauncher?.invoke()
            }

            // Return a mock tab
            callCallback(callbackId, JSONObject().apply {
                put("id", 2)
                put("url", url)
                put("active", true)
                put("status", "complete")
            }.toString())
        } catch (e: Exception) {
            Log.e(TAG, "tabs.create failed", e)
            callCallback(callbackId, JSONObject().apply { put("id", 2) }.toString())
        }
    }

    @JavascriptInterface
    fun tabsUpdate(tabId: Int, updatePropertiesJson: String, callbackId: String) {
        callCallback(callbackId, JSONObject().apply { put("id", tabId); put("url", AppConfig.FIXED_WEBSITE_URL) }.toString())
    }

    @JavascriptInterface
    fun tabsRemove(tabIdsJson: String, callbackId: String) { callCallback(callbackId, "true") }

    @JavascriptInterface
    fun tabsExecuteScript(tabId: Int, detailsJson: String, callbackId: String) {
        eventDispatcher.executeScriptInTab(detailsJson, callbackId)
    }

    @JavascriptInterface
    fun tabsInsertCSS(tabId: Int, detailsJson: String, callbackId: String) {
        eventDispatcher.executeScriptInTab(detailsJson, callbackId)
    }

    // ═══════════════════════════════════════════════════
    //  chrome.action / browserAction
    // ═══════════════════════════════════════════════════

    @JavascriptInterface
    fun actionSetPopup(detailsJson: String) { eventDispatcher.onActionUpdated(detailsJson) }
    @JavascriptInterface
    fun actionSetTitle(detailsJson: String) { eventDispatcher.onActionUpdated(detailsJson) }
    @JavascriptInterface
    fun actionSetBadgeText(detailsJson: String) { eventDispatcher.onActionUpdated(detailsJson) }
    @JavascriptInterface
    fun actionSetBadgeBackgroundColor(detailsJson: String) { eventDispatcher.onActionUpdated(detailsJson) }
    @JavascriptInterface
    fun actionOnClicked(callbackId: String) {
        // TRADEX AUTO: clicking the extension icon opens the launcher
        onOpenLauncher?.invoke()
        eventDispatcher.requestShowPopup(callbackId)
    }

    // ═══════════════════════════════════════════════════
    //  chrome.webNavigation (stub — events fired natively)
    // ═══════════════════════════════════════════════════

    @JavascriptInterface
    fun webNavigationGetFrame(detailsJson: String, callbackId: String) {
        callCallback(callbackId, JSONObject().apply {
            put("frameId", 0); put("parentFrameId", -1)
            put("url", AppConfig.FIXED_WEBSITE_URL)
        }.toString())
    }

    @JavascriptInterface
    fun webNavigationGetAllFrames(detailsJson: String, callbackId: String) {
        callCallback(callbackId, JSONArray().put(JSONObject().apply {
            put("frameId", 0); put("parentFrameId", -1)
            put("url", AppConfig.FIXED_WEBSITE_URL)
        }).toString())
    }

    // ═══════════════════════════════════════════════════
    //  chrome.scripting (for anti-block re-injection)
    // ═══════════════════════════════════════════════════

    @JavascriptInterface
    fun scriptingExecuteScript(detailsJson: String, callbackId: String) {
        eventDispatcher.executeScriptInTab(detailsJson, callbackId)
    }

    @JavascriptInterface
    fun scriptingInsertCSS(detailsJson: String, callbackId: String) {
        eventDispatcher.executeScriptInTab(detailsJson, callbackId)
    }

    // ═══════════════════════════════════════════════════
    //  chrome.declarativeNetRequest (stub)
    //  Rules are applied at the WebView level via URL filtering.
    // ═══════════════════════════════════════════════════

    @JavascriptInterface
    fun declarativeNetRequestUpdateDynamicRules(rulesJson: String, callbackId: String) {
        // Stub — rules.json from the extension is loaded and applied
        // by intercepting URLs in KioskWebViewManager.shouldInterceptRequest
        callCallback(callbackId, "true")
    }

    // ═══════════════════════════════════════════════════
    //  chrome.alarms
    // ═══════════════════════════════════════════════════

    @JavascriptInterface
    fun alarmsCreate(name: String, alarmInfoJson: String) {
        try {
            val info = JSONObject(alarmInfoJson)
            val delayMs = info.optLong("delayInMinutes", 1) * 60_000L
            val periodMs = info.optLong("periodInMinutes", 0) * 60_000L
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, AlarmReceiver::class.java).apply {
                putExtra("alarm_name", name); putExtra("extension_id", AppConfig.EXTENSION_ID)
            }
            val pi = PendingIntent.getBroadcast(context, name.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            if (periodMs > 0) alarmManager.setRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + delayMs, periodMs, pi)
            else if (delayMs > 0) alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + delayMs, pi)
            alarms[name] = pi
        } catch (e: Exception) { Log.e(TAG, "alarms.create failed", e) }
    }

    @JavascriptInterface
    fun alarmsClear(name: String, callbackId: String) {
        alarms.remove(name)?.let { (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(it) }
        callCallback(callbackId, "true")
    }

    @JavascriptInterface
    fun alarmsClearAll(callbackId: String) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarms.values.forEach { am.cancel(it) }; alarms.clear(); callCallback(callbackId, "true")
    }

    @JavascriptInterface
    fun alarmsGetAll(callbackId: String) {
        callCallback(callbackId, gson.toJson(alarms.keys.map { mapOf("name" to it) }))
    }

    // ═══════════════════════════════════════════════════
    //  chrome.notifications
    // ═══════════════════════════════════════════════════

    @JavascriptInterface
    fun notificationsCreate(notificationId: String, optionsJson: String, callbackId: String) {
        try {
            val options = JSONObject(optionsJson)
            val title = options.optString("title", "")
            val message = options.optString("message", "")
            val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.app.Notification.Builder(context, NOTIFICATION_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION") android.app.Notification.Builder(context)
            }.apply { setContentTitle(title); setContentText(message); setSmallIcon(android.R.drawable.ic_dialog_info); setAutoCancel(true) }.build()
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(notificationId.hashCode(), notification)
            callCallback(callbackId, notificationId)
        } catch (e: Exception) { Log.e(TAG, "notification.create failed", e); callCallback(callbackId, "\"error\"") }
    }

    @JavascriptInterface
    fun notificationsClear(notificationId: String, callbackId: String) {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(notificationId.hashCode())
        callCallback(callbackId, "true")
    }

    // ═══════════════════════════════════════════════════
    //  chrome.windows
    // ═══════════════════════════════════════════════════

    @JavascriptInterface
    fun windowsGetCurrent(getInfoJson: String, callbackId: String) {
        callCallback(callbackId, JSONObject().apply {
            put("id", 1); put("focused", true); put("state", "maximized")
            put("top", 0); put("left", 0); put("width", 1080); put("height", 1920)
            put("alwaysOnTop", true); put("incognito", false); put("type", "normal")
        }.toString())
    }

    @JavascriptInterface
    fun windowsUpdate(windowId: Int, updateInfoJson: String, callbackId: String) {
        callCallback(callbackId, JSONObject().apply { put("id", windowId); put("focused", true) }.toString())
    }

    // ═══════════════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════════════

    fun callCallback(callbackId: String, result: String) {
        if (callbackId.isBlank()) return
        eventDispatcher.invokeCallback(callbackId, result)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(NotificationChannel(NOTIFICATION_CHANNEL_ID, NOTIFICATION_CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT))
        }
    }

    data class PortConnection(val extensionId: String, val connectInfo: String, val callbackId: String)
}
