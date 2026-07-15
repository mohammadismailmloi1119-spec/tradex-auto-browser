package com.kioskbrowser.extension

import android.content.Context
import com.google.gson.Gson
import com.kioskbrowser.KioskApplication
import com.kioskbrowser.AppConfig
import com.kioskbrowser.extension.model.ExtensionManifest
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

/**
 * Loads a single Chrome extension from assets/ into the app's
 * internal storage for runtime access.
 *
 * Supports three formats:
 * - **Unpacked**: a folder containing manifest.json + resources.
 * - **ZIP**: a single .zip archive (unpacked on first launch).
 * - **CRX**: Chrome extension package (unpacked by extracting the ZIP payload).
 *
 * The extension is extracted once to `{internalFilesDir}/extension/`
 * and re-used on subsequent launches.
 */
class ExtensionLoader(private val context: Context) {

    companion object {
        private const val TAG = "ExtensionLoader"
        /** Directory name inside internal storage where the live extension resides. */
        private const val EXTENSION_DIR_NAME = "loaded_extension"
    }

    private val gson = Gson()

    /** Target directory where the unpacked extension lives. */
    var extensionRootDir: File? = null
        private set

    /** Cached manifest after successful load. */
    var manifest: ExtensionManifest? = null
        private set

    /** Whether the extension was loaded successfully. */
    var isLoaded: Boolean = false
        private set

    /** Human-readable error message if loading failed. */
    var lastError: String? = null
        private set

    /** Absolute path to the extracted extension root directory (legacy alias). */
    private val extensionDir: File
        get() = File(context.filesDir, EXTENSION_DIR_NAME)

    /**
     * Load the extension from assets synchronously.
     *
     * Call this before initializing the WebView so content scripts
     * can be injected from the very first page load.
     *
     * @return true if the extension loaded successfully.
     */
    fun load(): Boolean {
        val assetPath = AppConfig.EXTENSION_ASSET_PATH

        return try {
            // Check if already unpacked from a previous launch
            if (isExtensionExtracted()) {
                Log.i(TAG, "Extension already extracted, reusing")
                extensionRootDir = extensionDir
                manifest = parseManifest(File(extensionDir, "manifest.json"))
                isLoaded = manifest != null
                if (!isLoaded) lastError = "Failed to parse cached manifest.json"
                return isLoaded
            }

            // Clean and recreate
            extensionDir.deleteRecursively()
            extensionDir.mkdirs()

            // Determine format and extract
            val assetFiles = context.assets.list(assetPath) ?: emptyArray()

            when {
                // Case 1: Unpacked folder (contains manifest.json directly)
                assetFiles.contains("manifest.json") -> {
                    Log.i(TAG, "Loading unpacked extension from: $assetPath")
                    copyAssetDir(assetPath, extensionDir)
                }
                // Case 2: Single .zip file
                assetFiles.any { it.endsWith(".zip") } -> {
                    val zipFile = assetFiles.first { it.endsWith(".zip") }
                    Log.i(TAG, "Loading ZIP extension: $zipFile")
                    extractZip("$assetPath/$zipFile", extensionDir)
                }
                // Case 3: Single .crx file
                assetFiles.any { it.endsWith(".crx") } -> {
                    val crxFile = assetFiles.first { it.endsWith(".crx") }
                    Log.i(TAG, "Loading CRX extension: $crxFile")
                    extractCrx("$assetPath/$crxFile", extensionDir)
                }
                // Case 4: The asset path itself is a zip/crx
                assetPath.endsWith(".zip") -> {
                    Log.i(TAG, "Loading ZIP extension from: $assetPath")
                    copyAssetFile(assetPath, File(context.filesDir, "ext.zip"))
                    extractZipFile(File(context.filesDir, "ext.zip"), extensionDir)
                }
                assetPath.endsWith(".crx") -> {
                    Log.i(TAG, "Loading CRX extension from: $assetPath")
                    copyAssetFile(assetPath, File(context.filesDir, "ext.crx"))
                    extractCrxFile(File(context.filesDir, "ext.crx"), extensionDir)
                }
                else -> {
                    lastError = "No extension found at assets/$assetPath"
                    Log.e(TAG, lastError!!)
                    isLoaded = false
                    return false
                }
            }

            // Parse the manifest
            val manifestFile = File(extensionDir, "manifest.json")
            if (!manifestFile.exists()) {
                lastError = "manifest.json not found after extraction"
                Log.e(TAG, lastError!!)
                isLoaded = false
                return false
            }

            manifest = parseManifest(manifestFile)
            extensionRootDir = extensionDir
            isLoaded = manifest != null

            if (isLoaded) {
                Log.i(TAG, "Extension loaded: ${manifest!!.name} v${manifest!!.version} (MV${manifest!!.manifestVersion})")
            } else {
                lastError = "Failed to parse manifest.json"
            }

            isLoaded
        } catch (e: Exception) {
            lastError = "Extension load error: ${e.message}"
            Log.e(TAG, lastError!!, e)
            isLoaded = false
            false
        }
    }

    // ───────────────────────────────────────────
    // Private helpers
    // ───────────────────────────────────────────

    private fun isExtensionExtracted(): Boolean {
        return File(extensionDir, "manifest.json").exists()
    }

    // ─────────────────────────────────────────────────
    //  Content Script Accessors
    // ─────────────────────────────────────────────────

    /**
     * Returns content scripts whose [matches] patterns cover the given [url].
     */
    fun getContentScriptsForUrl(url: String): List<com.kioskbrowser.extension.model.ContentScript> {
        val all = manifest?.contentScripts ?: return emptyList()
        return all.filter { cs ->
            (cs.matches ?: emptyList()).any { pattern -> urlMatchesPattern(url, pattern) }
        }
    }

    /**
     * Read the content of an extension file relative to the extension root.
     */
    fun readExtensionFile(relativePath: String): String? {
        val file = extensionRootDir?.let { File(it, relativePath) } ?: return null
        return if (file.exists()) file.readText() else null
    }

    /**
     * Simple glob-to-regex pattern matching for extension URL patterns.
     */
    private fun urlMatchesPattern(url: String, pattern: String): Boolean {
        if (pattern == "<all_urls>") return true
        var regexStr = Regex.escape(pattern)
            .replace("\\*", ".*")
            .replace("\\?", ".")
        if (!regexStr.startsWith("^")) regexStr = "^$regexStr"
        if (!regexStr.endsWith("$")) regexStr = "$regexStr"
        return try {
            Regex(regexStr, RegexOption.IGNORE_CASE).matches(url)
        } catch (e: Exception) {
            Log.w(TAG, "Invalid URL pattern: $pattern", e)
            false
        }
    }

    private fun parseManifest(file: File): ExtensionManifest? {
        return try {
            val json = file.readText(Charsets.UTF_8)
            gson.fromJson(json, ExtensionManifest::class.java)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse manifest.json: ${e.message}", e)
            null
        }
    }

    /**
     * Recursively copy an asset directory to the filesystem.
     */
    private fun copyAssetDir(assetPath: String, destDir: File) {
        destDir.mkdirs()
        val files = context.assets.list(assetPath) ?: return
        for (file in files) {
            val assetFilePath = "$assetPath/$file"
            val destFile = File(destDir, file)

            // Check if it's a subdirectory
            val subFiles = context.assets.list(assetFilePath)
            if (subFiles != null && subFiles.isNotEmpty()) {
                copyAssetDir(assetFilePath, destFile)
            } else {
                copyAssetFile(assetFilePath, destFile)
            }
        }
    }

    /**
     * Copy a single asset file to a destination.
     */
    private fun copyAssetFile(assetPath: String, destFile: File) {
        context.assets.open(assetPath).use { input ->
            FileOutputStream(destFile).use { output ->
                input.copyTo(output, bufferSize = 8192)
            }
        }
    }

    /**
     * Extract a ZIP from assets to a destination directory.
     */
    private fun extractZip(assetPath: String, destDir: File) {
        val tempFile = File(context.cacheDir, "ext_temp.zip")
        copyAssetFile(assetPath, tempFile)
        extractZipFile(tempFile, destDir)
        tempFile.delete()
    }

    /**
     * Extract a ZIP file to a directory.
     */
    private fun extractZipFile(zipFile: File, destDir: File) {
        destDir.mkdirs()
        ZipInputStream(zipFile.inputStream()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val entryFile = File(destDir, entry.name)

                // Security: prevent zip-slip path traversal
                if (!entryFile.canonicalPath.startsWith(destDir.canonicalPath)) {
                    Log.w(TAG, "Skipping potentially unsafe ZIP entry: ${entry.name}")
                    entry = zis.nextEntry
                    continue
                }

                if (entry.isDirectory) {
                    entryFile.mkdirs()
                } else {
                    entryFile.parentFile?.mkdirs()
                    FileOutputStream(entryFile).use { output ->
                        zis.copyTo(output, bufferSize = 8192)
                    }
                }
                entry = zis.nextEntry
            }
            zis.closeEntry()
        }
    }

    /**
     * Extract a CRX file from assets.
     * CRX v2/v3 header is stripped, then the remaining ZIP payload is extracted.
     */
    private fun extractCrx(assetPath: String, destDir: File) {
        val tempFile = File(context.cacheDir, "ext_temp.crx")
        copyAssetFile(assetPath, tempFile)
        extractCrxFile(tempFile, destDir)
        tempFile.delete()
    }

    /**
     * Extract a CRX file.
     *
     * CRX format:
     * - Magic number: "Cr24" (4 bytes)
     * - Version: 2 or 3 (4 bytes LE)
     * - ... header ...
     * - ZIP archive payload
     */
    private fun extractCrxFile(crxFile: File, destDir: File) {
        val bytes = crxFile.readBytes()
        val magic = bytes.copyOfRange(0, 4).toString(Charsets.UTF_8)

        if (magic != "Cr24") {
            throw IllegalStateException("Invalid CRX file: bad magic number")
        }

        val version = bytes.copyOfRange(4, 8).let {
            (it[0].toInt() and 0xFF) or
                    ((it[1].toInt() and 0xFF) shl 8) or
                    ((it[2].toInt() and 0xFF) shl 16) or
                    ((it[3].toInt() and 0xFF) shl 24)
        }

        val zipStart = when (version) {
            2 -> {
                val pubKeyLen = bytes.copyOfRange(8, 12).let {
                    (it[0].toInt() and 0xFF) or
                            ((it[1].toInt() and 0xFF) shl 8) or
                            ((it[2].toInt() and 0xFF) shl 16) or
                            ((it[3].toInt() and 0xFF) shl 24)
                }
                val sigLen = bytes.copyOfRange(12, 16).let {
                    (it[0].toInt() and 0xFF) or
                            ((it[1].toInt() and 0xFF) shl 8) or
                            ((it[2].toInt() and 0xFF) shl 16) or
                            ((it[3].toInt() and 0xFF) shl 24)
                }
                16 + pubKeyLen + sigLen
            }
            3 -> {
                val headerLen = bytes.copyOfRange(8, 12).let {
                    (it[0].toInt() and 0xFF) or
                            ((it[1].toInt() and 0xFF) shl 8) or
                            ((it[2].toInt() and 0xFF) shl 16) or
                            ((it[3].toInt() and 0xFF) shl 24)
                }
                12 + headerLen
            }
            else -> throw IllegalStateException("Unsupported CRX version: $version")
        }

        // Extract ZIP payload
        val zipBytes = bytes.copyOfRange(zipStart, bytes.size)
        val tempZip = File(context.cacheDir, "crx_payload.zip")
        tempZip.writeBytes(zipBytes)
        extractZipFile(tempZip, destDir)
        tempZip.delete()

        Log.i(TAG, "CRX v$version extracted (${zipBytes.size} bytes payload)")
    }
}
