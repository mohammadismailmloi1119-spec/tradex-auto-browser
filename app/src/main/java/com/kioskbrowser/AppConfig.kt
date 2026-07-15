/*
 * AppConfig — Central Configuration File
 * ALL configurable values live here.
 * Change URL or extension path: edit this file, rebuild — no other code changes needed.
 *
 * TRADEX-AUTO PRO Extension:
 *   Built-in extension placed in assets/extension/ (unpacked format).
 *   Auto-loads at startup. Provides WinGo auto-betting with license key validation.
 */

package com.kioskbrowser

import android.graphics.Color

object AppConfig {

    // ═══════════════════════════════════════════════════
    //  WEBSITE
    // ═══════════════════════════════════════════════════

    /** The single fixed website the kiosk browser loads. */
    const val FIXED_WEBSITE_URL: String = "https://bdgwin901.com/#/register?invitationCode=4871414737723"

    // ═══════════════════════════════════════════════════
    //  EXTENSION — TRADEX AUTO PRO (built-in default)
    // ═══════════════════════════════════════════════════

    /**
     * Path to the extension in assets/.
     *
     * The extension is stored unpacked at assets/extension/.
     * All 10 files (manifest.json, content.js, content.css, background.js,
     * launcher.html, popup.html, popup.js, unblocker.js, rules.json, ball_logo.jpg)
     * are loaded automatically at startup.
     *
     * To replace with a different extension: replace the folder contents.
     */
    const val EXTENSION_ASSET_PATH: String = "extension"

    /** Unique extension ID (matches the extension's identity). */
    const val EXTENSION_ID: String = "tradex_auto_pro"

    /** Maximum time (ms) for extension init before proceeding without it. */
    const val EXTENSION_INIT_TIMEOUT_MS: Long = 15_000L

    /**
     * Custom user-agent suffix for this extension.
     * The default Chrome WebView UA may be detected and blocked by some sites.
     * Leave empty to use the default WebView UA.
     */
    const val CUSTOM_USER_AGENT_SUFFIX: String = ""

    // ═══════════════════════════════════════════════════
    //  SPLASH SCREEN
    // ═══════════════════════════════════════════════════

    const val SPLASH_DURATION_MS: Long = 1500L
    const val SPLASH_MIN_DURATION_MS: Long = 800L

    // ═══════════════════════════════════════════════════
    //  APP IDENTITY
    // ═══════════════════════════════════════════════════

    const val APP_DISPLAY_NAME: String = "TRADEX AUTO"
    const val APP_VERSION_NAME: String = "1.0.0"

    // ═══════════════════════════════════════════════════
    //  THEME COLORS — Dark theme matching the extension
    // ═══════════════════════════════════════════════════

    val COLOR_PRIMARY: Int = Color.parseColor("#1A1A2E")
    val COLOR_PRIMARY_DARK: Int = Color.parseColor("#0D0D1A")
    val COLOR_ACCENT: Int = Color.parseColor("#00E5FF")
    val COLOR_BACKGROUND: Int = Color.parseColor("#0D0D1A")
    val COLOR_SURFACE: Int = Color.parseColor("#16213E")
    val COLOR_ERROR: Int = Color.parseColor("#FF1744")
    val COLOR_ON_PRIMARY: Int = Color.parseColor("#FFFFFF")
    val COLOR_SPLASH_BACKGROUND: Int = Color.parseColor("#0D0D1A")
    val COLOR_PROGRESS_BAR: Int = Color.parseColor("#00E5FF")
    val COLOR_OFFLINE_BACKGROUND: Int = Color.parseColor("#111827")
    val COLOR_OFFLINE_TEXT: Int = Color.parseColor("#E0E0E0")

    // ═══════════════════════════════════════════════════
    //  PERFORMANCE — Device-Tiered Cache
    // ═══════════════════════════════════════════════════

    const val LOW_RAM_THRESHOLD_MB: Long = 2048L
    const val HIGH_RAM_THRESHOLD_MB: Long = 6144L
    val DISK_CACHE_SIZE_LOW: Long = 20L * 1024 * 1024
    val DISK_CACHE_SIZE_MID: Long = 50L * 1024 * 1024
    val DISK_CACHE_SIZE_HIGH: Long = 100L * 1024 * 1024

    // ═══════════════════════════════════════════════════
    //  PERFORMANCE — WebView Tuning
    // ═══════════════════════════════════════════════════

    const val WEBVIEW_DEBUG_ENABLED: Boolean = false
    const val RENDERER_PRIORITY: Int = 0
    const val MEMORY_TRIM_INTERVAL_MS: Long = 120_000L
    const val CONNECTION_TIMEOUT_MS: Int = 30_000
    const val OFFLINE_RETRY_INTERVAL_MS: Long = 3_000L
    const val MAX_RETRY_ATTEMPTS: Int = 5

    // ═══════════════════════════════════════════════════
    //  SECURITY
    // ═══════════════════════════════════════════════════

    const val ENFORCE_HTTPS: Boolean = true
    const val SAFE_BROWSING_ENABLED: Boolean = true
    const val THIRD_PARTY_COOKIES_ENABLED: Boolean = false
}
