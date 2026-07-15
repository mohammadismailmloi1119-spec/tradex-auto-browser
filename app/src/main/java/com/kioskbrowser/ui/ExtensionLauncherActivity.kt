/*
 * ExtensionLauncherActivity — displays the TRADEX AUTO launcher.html page.
 *
 * This is opened when the extension calls chrome.tabs.create({ url: launcher.html })
 * (from background.js action.onClicked listener). It shows the extension's full
 * launcher/control panel in a dedicated activity.
 *
 * The launcher communicates with the extension's background via chrome.runtime.sendMessage
 * and storage.local, using the same __kioskExtensionBridge injected into this WebView.
 */

package com.kioskbrowser.ui

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import androidx.appcompat.app.AppCompatActivity
import com.kioskbrowser.R
import com.kioskbrowser.extension.ExtensionLoader
import com.kioskbrowser.extension.bridge.ExtensionBridge
import com.kioskbrowser.extension.bridge.ExtensionEventDispatcher
import java.io.File

class ExtensionLauncherActivity : AppCompatActivity() {

    private var extensionLoader: ExtensionLoader? = null
    private var bridge: ExtensionBridge? = null
    private var dispatcher: ExtensionEventDispatcher? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_extension_launcher)

        val wv = findViewById<WebView>(R.id.launcher_webview)
        configureLauncherWebView(wv)

        // Load extension
        extensionLoader = ExtensionLoader(this)
        dispatcher = ExtensionEventDispatcher()
        bridge = ExtensionBridge(this, extensionLoader!!, dispatcher!!)

        // Add the JS bridge so launcher.html can use chrome.* APIs
        val mBridge = bridge
        if (mBridge != null) {
            wv.addJavascriptInterface(mBridge, ExtensionBridge.INTERFACE_NAME)
            mBridge.onOpenLauncher = { /* already showing */ }
        }

        // Load launcher.html from extension directory
        val extDir = extensionLoader?.extensionRootDir
        val launcherFile = extDir?.let { File(it, "launcher.html") }

        if (launcherFile?.exists() == true) {
            wv.loadUrl("file://${launcherFile.absolutePath}")
        } else {
            wv.loadData(
                "<html><body style='background:#0d0d1a;color:#fff;padding:16px;font-family:sans-serif'>" +
                        "<h2>TRADEX AUTO Pro</h2><p>Launcher not found. Please verify the extension is loaded.</p>" +
                        "</body></html>",
                "text/html", "UTF-8"
            )
        }
    }

    private fun configureLauncherWebView(wv: WebView) {
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        }

        wv.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                // Inject the API shim into the launcher page
                injectApiShim(view)
            }
        }

        wv.webChromeClient = WebChromeClient()
    }

    /**
     * Inject the minimal chrome.* API shim so the launcher page
     * can use chrome.runtime, chrome.storage, chrome.tabs, etc.
     */
    private fun injectApiShim(wv: WebView) {
        val js = (this::class.java.classLoader?.getResourceAsStream("api_shim.js")?.bufferedReader()?.readText())
            ?: buildInlineShim()
        wv.evaluateJavascript(js, null)
    }

    private fun buildInlineShim(): String {
        val bn = ExtensionBridge.INTERFACE_NAME
        return """
(function() {
'use strict';
window.__kioskCallbacks = {};
var _c = 0;
function mc(fn) {
    if (!fn) return '';
    var id = 'cb_' + (++_c) + '_' + Date.now();
    window.__kioskCallbacks[id] = function(r) {
        try { fn(JSON.parse(r)); } catch(e) { fn(r); }
    };
    return id;
}
var b = window.$bn;
function bc(m) { var a = Array.prototype.slice.call(arguments, 1); return b[m].apply(b, a); }

if (typeof chrome === 'undefined') window.chrome = {};

chrome.runtime = {
    id: 'tradex_auto_pro',
    sendMessage: function(msg, cb) {
        bc('runtimeSendMessage', JSON.stringify(msg || {}), mc(cb));
    },
    getURL: function(p) { return bc('runtimeGetURL', p); },
    getManifest: function() { return JSON.parse(bc('runtimeGetManifest')); },
    onMessage: { _l: [], addListener: function(fn) { this._l.push(fn); }, removeListener: function(fn) { this._l = this._l.filter(function(l) { return l !== fn; }); }, hasListener: function(fn) { return this._l.indexOf(fn) >= 0; } },
    lastError: null,
    connect: function() { return { onMessage: { addListener: function() {} }, postMessage: function(m) { bc('runtimeSendMessage', JSON.stringify(m), ''); }, disconnect: function() {} }; }
};

chrome.storage = {
    local: {
        get: function(keys, cb) {
            var r = JSON.parse(bc('storageLocalGet', keys ? JSON.stringify(keys) : null));
            if (cb) cb(r);
            return Promise.resolve(r);
        },
        set: function(items, cb) {
            bc('storageLocalSet', JSON.stringify(items));
            if (cb) cb();
            return Promise.resolve();
        },
        remove: function(keys, cb) { bc('storageLocalRemove', JSON.stringify(keys)); if (cb) cb(); return Promise.resolve(); },
        clear: function(cb) { bc('storageLocalClear'); if (cb) cb(); return Promise.resolve(); }
    }
};

chrome.tabs = {
    query: function(q, cb) { bc('tabsQuery', JSON.stringify(q || {}), mc(cb)); },
    create: function(p, cb) { bc('tabsCreate', JSON.stringify(p || {}), mc(cb)); },
    update: function(id, p, cb) { bc('tabsUpdate', id, JSON.stringify(p || {}), mc(cb)); }
};

chrome.action = {
    setPopup: function() {}, setTitle: function() {}, setBadgeText: function() {},
    onClicked: { addListener: function(fn) { _actionClicked = fn; } }
};
chrome.browserAction = chrome.action;

chrome.alarms = {
    create: function(n, ai) { bc('alarmsCreate', n || '', JSON.stringify(ai || {})); },
    clear: function(n, cb) { bc('alarmsClear', n || '', mc(cb)); }
};

chrome.notifications = {
    create: function(id, o, cb) { bc('notificationsCreate', id || '', JSON.stringify(o || {}), mc(cb)); }
};

chrome.windows = {
    WINDOW_ID_CURRENT: -2,
    getCurrent: function(gi, cb) { bc('windowsGetCurrent', JSON.stringify(gi || {}), mc(cb)); },
    update: function(wid, ui, cb) { bc('windowsUpdate', wid, JSON.stringify(ui || {}), mc(cb)); }
};

chrome.webNavigation = {
    onCommitted: { addListener: function() {}, removeListener: function() {} },
    onCompleted: { addListener: function() {}, removeListener: function() {} }
};

chrome.scripting = {
    executeScript: function(inj, cb) {
        bc('scriptingExecuteScript', JSON.stringify(inj), mc(cb));
    },
    insertCSS: function(inj, cb) {
        bc('scriptingInsertCSS', JSON.stringify(inj), mc(cb));
    }
};

chrome.declarativeNetRequest = {
    updateDynamicRules: function(opts, cb) { bc('declarativeNetRequestUpdateDynamicRules', JSON.stringify(opts), mc(cb)); }
};

chrome.i18n = { getMessage: function(k) { return k; }, getUILanguage: function() { return 'en'; } };
window.browser = chrome;
console.log('[TRADEX] Launcher API shim ready');
})();
""".trimIndent()
    }

    override fun onDestroy() {
        super.onDestroy()
        findViewById<WebView>(R.id.launcher_webview)?.destroy()
    }
}
