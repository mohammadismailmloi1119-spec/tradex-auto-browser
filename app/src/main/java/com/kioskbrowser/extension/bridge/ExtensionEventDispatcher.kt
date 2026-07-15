/*
 * ExtensionEventDispatcher — routes extension events between JS and native.
 */

package com.kioskbrowser.extension.bridge

import android.util.Log
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue

class ExtensionEventDispatcher {

    companion object { private const val TAG = "ExtEventDispatcher" }

    private val pendingCallbacks = ConcurrentHashMap<String, String>()
    private val messageListeners = ConcurrentLinkedQueue<MessageListener>()
    private val actionListeners = ConcurrentLinkedQueue<ActionListener>()
    private val popupListeners = ConcurrentLinkedQueue<PopupListener>()
    private val scriptInjectionListeners = ConcurrentLinkedQueue<ScriptInjectionListener>()

    @Volatile var webView: WebView? = null

    data class MessageListener(val onMessage: (JSONObject, JSONObject, (String) -> Unit) -> Unit)
    data class ActionListener(val onUpdated: (String) -> Unit, val onClicked: (String) -> Unit)
    data class PopupListener(val onShowPopup: (String) -> Unit)
    data class ScriptInjectionListener(val onExecuteScript: (String, String) -> Unit)

    fun addMessageListener(l: MessageListener) = messageListeners.add(l)
    fun addActionListener(l: ActionListener) = actionListeners.add(l)
    fun addPopupListener(l: PopupListener) = popupListeners.add(l)
    fun addScriptInjectionListener(l: ScriptInjectionListener) = scriptInjectionListeners.add(l)

    fun dispatchRuntimeMessage(message: JSONObject, callbackId: String) {
        val sender = JSONObject().apply { put("id", "kiosk_extension_001"); put("url", "https://bdgwin901.com") }
        messageListeners.forEach { try { it.onMessage(message, sender) { invokeCallback(callbackId, it) } } catch (e: Exception) { Log.e(TAG, "Msg listener err", e) } }
    }

    fun onPortConnect(portId: String, callbackId: String) {
        invokeCallback(callbackId, JSONObject().apply { put("name", portId); put("sender", JSONObject().apply { put("id", "kiosk_extension_001") }) }.toString())
    }

    fun onActionUpdated(detailsJson: String) { actionListeners.forEach { try { it.onUpdated(detailsJson) } catch (e: Exception) { Log.e(TAG, "Action err", e) } } }
    fun requestShowPopup(callbackId: String) { popupListeners.forEach { try { it.onShowPopup(callbackId) } catch (e: Exception) { Log.e(TAG, "Popup err", e) } } }
    fun executeScriptInTab(detailsJson: String, callbackId: String) { scriptInjectionListeners.forEach { try { it.onExecuteScript(detailsJson, callbackId) } catch (e: Exception) { Log.e(TAG, "Script err", e) } } }

    fun invokeCallback(callbackId: String, result: String) {
        val escaped = result.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r")
        pendingCallbacks[callbackId] = "__kioskCallbacks['$callbackId']('$escaped'); delete __kioskCallbacks['$callbackId'];"
        flushCallbacks()
    }

    fun flushCallbacks() {
        if (pendingCallbacks.isEmpty()) return
        val wv = webView ?: return
        val sb = StringBuilder()
        while (pendingCallbacks.isNotEmpty()) { val cb = pendingCallbacks.values.iterator().next(); sb.append(cb); pendingCallbacks.values.remove(cb) }
        wv.post { try { wv.evaluateJavascript(sb.toString(), null) } catch (e: Exception) { Log.e(TAG, "Callback eval fail", e) } }
    }

    fun clear() { pendingCallbacks.clear(); messageListeners.clear(); actionListeners.clear(); popupListeners.clear(); scriptInjectionListeners.clear() }
}
