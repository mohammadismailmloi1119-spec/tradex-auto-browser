/*
 * ExtensionPopupActivity — displays the extension popup page.
 */

package com.kioskbrowser.ui

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.kioskbrowser.R
import com.kioskbrowser.extension.ExtensionLoader
import java.io.File

class ExtensionPopupActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_extension_popup)
        val extLoader = ExtensionLoader(this)
        val wv = findViewById<WebView>(R.id.popup_webview)
        wv.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = true; allowContentAccess = true }
        wv.webViewClient = WebViewClient()
        val popupPath = extLoader.manifest?.action?.defaultPopup ?: extLoader.manifest?.browserAction?.defaultPopup
        if (popupPath != null) {
            val f = extLoader.extensionRootDir?.let { File(it, popupPath) }
            if (f?.exists() == true) wv.loadUrl("file://${f.absolutePath}")
            else wv.loadData("<html><body style='padding:16px;font-family:sans-serif'><p>Popup not found: $popupPath</p></body></html>", "text/html", "UTF-8")
        } else {
            wv.loadData("<html><body style='padding:16px;font-family:sans-serif;text-align:center'><h3>${extLoader.manifest?.name ?: "Extension"}</h3><p>No popup configured</p></body></html>", "text/html", "UTF-8")
        }
        findViewById<android.view.View>(R.id.popup_outside)?.setOnClickListener { finish() }
    }
}
