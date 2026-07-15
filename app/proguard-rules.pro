# Add project specific ProGuard rules here.
# KioskBrowser ProGuard / R8 Rules

# ---- Keep WebView JavaScript interfaces ----
-keepclassmembers class com.kioskbrowser.webview.KioskWebViewClient$JsBridgeInterface {
    public *;
}
-keepclassmembers class com.kioskbrowser.extension.ExtensionBridge {
    public *;
}

# ---- Keep extension-related classes ----
-keep class com.kioskbrowser.extension.** { *; }
-keep class com.kioskbrowser.util.** { *; }

# ---- Gson serialization ----
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.google.gson.** { *; }
-keep class com.kioskbrowser.extension.model.** { *; }

# ---- AndroidX WebKit ----
-keep class androidx.webkit.** { *; }

# ---- Coroutines ----
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# ---- General ----
-keepattributes SourceFile,LineNumberTable
-keepattributes EnclosingMethod
-dontwarn javax.annotation.**
-dontwarn org.bouncycastle.**
