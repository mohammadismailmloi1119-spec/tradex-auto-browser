# TRADEX AUTO — Android Kiosk Browser with Built-in Extension

Production-ready Android kiosk browser that loads the TRADEX AUTO Pro auto-betting extension for WinGo game on bdgwin901.com.

## Built-in Extension

The **TRADEX AUTO Pro v2.0** extension is pre-bundled in `app/src/main/assets/extension/`:

| File | Size | Purpose |
|------|------|---------|
| `manifest.json` | 1.2 KB | Manifest V3 extension definition |
| `content.js` | 128 KB | Main content script (auto-bet logic, key validation, UI panel) |
| `content.css` | 25 KB | Extension UI styles (dark theme) |
| `background.js` | 3.5 KB | Service worker (launcher, API polling, anti-block re-injection) |
| `unblocker.js` | 10 KB | Anti-blocking injection at document_start |
| `launcher.html` | 15 KB | Full-screen control panel |
| `popup.html` | 4 KB | Extension popup |
| `popup.js` | 1.2 KB | Popup logic |
| `rules.json` | 0.9 KB | Declarative net request rules |
| `ball_logo.jpg` | 125 KB | Extension logo asset |

**Key behaviors:**
- Binds to `chrome.action.onClicked` → opens launcher.html as a full-screen activity
- Runs `chrome.webNavigation.onCommitted` listener to detect when content.js fails to load, then force-reinjects via `scripting.executeScript`
- Polls `draw.ar-lottery01.com` API every 5 seconds for WinGo results
- Uses `chrome.storage.local` for license key, device fingerprint, and UID persistence
- Validates license keys against server at `auto-tradex-admin-2.onrender.com`
- Key expiry timer starts on first activation; expired keys block the panel

## Quick Start

### Prerequisites
- Android Studio Hedgehog (2023.1.1) or later
- JDK 17
- Android SDK 34 with build tools
- Device/emulator running Android 7.0 (API 24) or later

### Build

```bash
# Debug APK
./gradlew assembleDebug

# Release APK
./gradlew assembleRelease
```

APK: `app/build/outputs/apk/debug/app-debug.apk`

### Install

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Configuration

All values in one file: **`app/src/main/java/com/kioskbrowser/AppConfig.kt`**

| Setting | Default | Description |
|---|---|---|
| `FIXED_WEBSITE_URL` | `https://bdgwin901.com/#/register?invitationCode=4871414737723` | Target URL |
| `EXTENSION_ASSET_PATH` | `extension` | Path in assets/ |
| `EXTENSION_ID` | `tradex_auto_pro` | Internal ID |
| `SPLASH_DURATION_MS` | `1500` | Splash display time |
| `APP_DISPLAY_NAME` | `TRADEX AUTO` | App name |

## Extension API Support (chrome.*)

The extension's API calls are bridged to native Android equivalents:

| API | Method | Status |
|---|---|---|
| `chrome.action.onClicked` | Launcher trigger | ✅ Opens `ExtensionLauncherActivity` |
| `chrome.tabs.create` | Open launcher.html | ✅ Full Activity launch |
| `chrome.tabs.query` | Find existing launcher tab | ✅ Returns tab 1 |
| `chrome.storage.local` | Key/UID/device storage | ✅ SharedPreferences (persists across restarts) |
| `chrome.storage.local.get/set/remove` | CRUD operations | ✅ Full async support |
| `chrome.runtime.sendMessage` | Ext → bg messaging | ✅ Via dispatcher |
| `chrome.runtime.getURL` | Resolve extension paths | ✅ `chrome-extension://` scheme |
| `chrome.scripting.executeScript` | Anti-block re-injection | ✅ Injects files into WebView |
| `chrome.scripting.insertCSS` | Anti-block CSS injection | ✅ Injects CSS |
| `chrome.webNavigation.onCommitted` | Anti-block detection | ✅ Simulated via `onPageFinished` |
| `chrome.windows.update` | Focus window | ✅ No-op (single window) |
| `chrome.declarativeNetRequest` | Network rules | ✅ Rules loaded, applied via URL filtering |
| `chrome.alarms` | Timer-based tasks | ✅ Android AlarmManager |
| `chrome.notifications` | User alerts | ✅ Android NotificationManager |

**Limitations (WebView constraints):**
- `chrome.webRequest.*` — listeners registered but network events not relayed (no interception API in WebView)
- `chrome.declarativeNetRequest` — rules loaded as stub; URL-level filtering done via `shouldInterceptRequest`
- No true separate background process — service workers injected as persistent page scripts

## Architecture

```
app/src/main/java/com/kioskbrowser/
├── AppConfig.kt                  ← ALL configuration
├── KioskApplication.kt           ← RAM detection, WebView pre-warming
├── extension/
│   ├── ExtensionLoader.kt        ← Loads from assets (unpacked/ZIP/CRX)
│   ├── model/ExtensionManifest.kt ← manifest.json data classes
│   └── bridge/
│       ├── ExtensionBridge.kt        ← JS bridge (@JavascriptInterface)
│       ├── ExtensionEventDispatcher.kt ← Message/callback routing
│       ├── ExtensionInjectionManager.kt ← API shim + content script injection
│       └── AlarmReceiver.kt          ← chrome.alarms → AlarmManager
├── webview/
│   └── KioskWebViewManager.kt    ← WebView lifecycle & crash recovery
└── ui/
    ├── SplashActivity.kt         ← Splash → MainActivity
    ├── MainActivity.kt           ← Kiosk browser (full-screen)
    ├── ExtensionLauncherActivity.kt ← TRADEX AUTO launcher panel
    ├── ExtensionPopupActivity.kt ← Extension popup dialog
    └── ExtensionOptionsActivity.kt ← Extension options page
```

## Permissions

Only 2 permissions: `INTERNET` + `ACCESS_NETWORK_STATE`. No camera, location, storage.

## Replacing the Extension

1. Delete `app/src/main/assets/extension/`
2. Place new extension files (unpacked, .zip, or .crx)
3. Update `AppConfig.EXTENSION_ASSET_PATH`
4. Rebuild

## Release Signing

Add to `local.properties`:
```properties
RELEASE_KEYSTORE_PATH=/path/to/keystore.jks
RELEASE_KEYSTORE_PASSWORD=your_password
RELEASE_KEY_ALIAS=your_alias
RELEASE_KEY_PASSWORD=your_key_password
```
