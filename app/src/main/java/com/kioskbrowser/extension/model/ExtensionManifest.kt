package com.kioskbrowser.extension.model

import com.google.gson.annotations.SerializedName

// ─────────────────────────────────────────────────────────────
// Data models for Chrome Extension manifest.json parsing
// Supports Manifest V2 and V3 side-by-side.
// ─────────────────────────────────────────────────────────────

/**
 * Top-level manifest structure.
 * Fields present in both MV2 and MV3.
 */
data class ExtensionManifest(
    @SerializedName("manifest_version") val manifestVersion: Int = 2,
    @SerializedName("name") val name: String = "Untitled Extension",
    @SerializedName("version") val version: String = "0.0.0",
    @SerializedName("description") val description: String? = null,
    @SerializedName("permissions") val permissions: List<String>? = null,
    @SerializedName("host_permissions") val hostPermissions: List<String>? = null, // MV3
    @SerializedName("optional_permissions") val optionalPermissions: List<String>? = null,

    // Content scripts (MV2 & MV3)
    @SerializedName("content_scripts") val contentScripts: List<ContentScript>? = null,

    // Background: MV2 uses "scripts", MV3 uses "service_worker"
    @SerializedName("background") val background: Background? = null,

    // Popup / action (MV3 renamed browser_action → action)
    @SerializedName("browser_action") val browserAction: Action? = null,
    @SerializedName("action") val action: Action? = null,

    // Options page (MV2)
    @SerializedName("options_page") val optionsPage: String? = null,
    @SerializedName("options_ui") val optionsUi: OptionsUI? = null, // MV3

    // Icons
    @SerializedName("icons") val icons: Map<String, String>? = null,

    // Web accessible resources
    @SerializedName("web_accessible_resources") val webAccessibleResources: List<WebAccessibleResource>? = null,

    // Declarative net request (MV3)
    @SerializedName("declarative_net_request") val declarativeNetRequest: DeclarativeNetRequest? = null,

    // Content security policy (string for MV2, object for MV3)
    @SerializedName("content_security_policy") val contentSecurityPolicy: Any? = null
)

/**
 * Declarative net request config (MV3).
 */
data class DeclarativeNetRequest(
    @SerializedName("rule_resources") val ruleResources: List<RuleResource>? = null
)

data class RuleResource(
    @SerializedName("id") val id: String? = null,
    @SerializedName("enabled") val enabled: Boolean? = null,
    @SerializedName("path") val path: String? = null
)

/**
 * Content script declaration.
 */
data class ContentScript(
    @SerializedName("matches") val matches: List<String>? = null,
    @SerializedName("exclude_matches") val excludeMatches: List<String>? = null,
    @SerializedName("js") val js: List<String>? = null,
    @SerializedName("css") val css: List<String>? = null,
    @SerializedName("run_at") val runAt: String? = "document_idle",
    @SerializedName("all_frames") val allFrames: Boolean? = false,
    @SerializedName("match_about_blank") val matchAboutBlank: Boolean? = false,
    @SerializedName("world") val world: String? = null // MV3: "ISOLATED" or "MAIN"
)

/**
 * Background configuration (MV2 or MV3).
 */
data class Background(
    // MV2: array of script files
    @SerializedName("scripts") val scripts: List<String>? = null,
    // MV3: single service worker file
    @SerializedName("service_worker") val serviceWorker: String? = null,
    @SerializedName("persistent") val persistent: Boolean? = null
)

/**
 * Browser action / page action (toolbar button).
 */
data class Action(
    @SerializedName("default_popup") val defaultPopup: String? = null,
    @SerializedName("default_title") val defaultTitle: String? = null,
    @SerializedName("default_icon") val defaultIcon: Any? = null
)

/**
 * Options UI (MV3 chrome://extensions options override).
 */
data class OptionsUI(
    @SerializedName("page") val page: String? = null,
    @SerializedName("open_in_tab") val openInTab: Boolean? = false
)

/**
 * Web accessible resources (MV3 structured format).
 */
data class WebAccessibleResource(
    @SerializedName("resources") val resources: List<String>? = null,
    @SerializedName("matches") val matches: List<String>? = null
)
