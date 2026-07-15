/*
 * ExtensionOptionsActivity — displays the extension's options page.
 */

package com.kioskbrowser.ui

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.kioskbrowser.R
import com.kioskbrowser.extension.ExtensionLoader
import java.io.File

class ExtensionOptionsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_extension_options)
        val extLoader = ExtensionLoader(this)
        val wv = findViewById<WebView>(R.id.options_webview)
        wv.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = true }
        wv.webViewClient = WebViewClient()
        val path = extLoader.manifest?.optionsUi?.page ?: extLoader.manifest?.optionsPage
        if (path != null) {
            val f = extLoader.extensionRootDir?.let { File(it, path) }
            if (f?.exists() == true) wv.loadUrl("file://${f.absolutePath}")
            else wv.loadData("<p>Options page not found</p>", "text/html", "UTF-8")
        } else wv.loadData("<p>No options configured</p>", "text/html", "UTF-8")
    }
}
