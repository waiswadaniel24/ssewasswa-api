# Comfort Zone — Mobile Build Guide (Capacitor)

This guide explains how to use **Capacitor** to build native iOS and Android apps from the Comfort Zone PWA.

---

## What is Capacitor?

[Capacitor](https://capacitorjs.com/) is a cross-platform native runtime by the Ionic team. It wraps your web application (HTML/CSS/JS) inside a native WebView, giving you access to native device features like push notifications, camera, geolocation, and the filesystem — all from JavaScript.

---

## Capacitor vs TWA (Trusted Web Activity)

| Feature | **Capacitor** | **TWA (Android only)** |
|---|---|---|
| **Platforms** | iOS + Android + Web | Android only |
| **App stores** | Apple App Store + Google Play | Google Play only |
| **Native APIs** | Full access (camera, GPS, push, etc.) | Limited |
| **Offline support** | Service Worker + local caching | Service Worker required |
| **App size** | ~15-30 MB (includes WebView) | ~2-5 MB (uses Chrome) |
| **Customization** | Full native UI control | Minimal |
| **Setup complexity** | Medium | Low |
| **Best for** | Feature-rich apps needing native APIs | Simple PWA wrappers on Android |

### When to Use Each

- **Use TWA** if: You only need Android, want the smallest possible app, and the PWA already works well with Service Workers.
- **Use Capacitor** if: You need iOS + Android, want push notifications, camera access, or any other native device features, and need more control over the native shell.

---

## Setting Up the Capacitor Project

### Prerequisites

- Node.js 18+
- iOS: macOS with Xcode 14+
- Android: Android Studio with Android SDK 33+

### Step 1: Create a New Capacitor Project

```bash
# Create a new project (outside this repo, or in a dedicated mobile-app/ folder)
mkdir comfort-zone-mobile
cd comfort-zone-mobile
npm init -y

# Install Capacitor core and CLI
npm install @capacitor/core
npm install -D @capacitor/cli
```

### Step 2: Initialize Capacitor

```bash
npx cap init "Comfort Zone" "com.comfortzone.app" --web-dir public
```

This creates a `capacitor.config.ts` file. Copy or adapt the settings from `capacitor.config.json` at the repo root.

### Step 3: Add Platforms

```bash
# Add Android
npm install @capacitor/android
npx cap add android

# Add iOS (requires macOS)
npm install @capacitor/ios
npx cap add ios
```

### Step 4: Install Plugins

```bash
# Push Notifications
npm install @capacitor/push-notifications
npx cap sync

# SplashScreen (usually included by default)
npm install @capacitor/splash-screen

# App Launcher (open links in external apps)
npm install @capacitor/app-launcher

# Status Bar
npm install @capacitor/status-bar

# Haptics (vibration feedback)
npm install @capacitor/haptics

# Device info
npm install @capacitor/device

# Sync all plugins to native projects
npx cap sync
```

### Step 5: Build and Run

```bash
# Sync web assets to native projects
npx cap sync

# Open in Android Studio
npx cap open android

# Open in Xcode (macOS only)
npx cap open ios
```

From Android Studio / Xcode, you can run on emulators or connected devices, create signed builds, and upload to app stores.

---

## Using the Existing Capacitor Config

The `capacitor.config.json` at the repo root is configured for **live URL mode**:

```json
{
  "server": {
    "url": "https://ssewasswa.onrender.com"
  }
}
```

This means the app loads directly from the live server — no need to bundle web assets. Updates to the web app are reflected immediately (no app store submission needed for content changes).

### Switching to Local Bundled Mode

To bundle the web assets with the app (for offline-first):

1. Build your web app and output to a directory
2. Update `capacitor.config.json`:
   ```json
   {
     "webDir": "path/to/your/build/output"
   }
   ```
3. Run `npx cap sync`

---

## Publishing to App Stores

### Google Play Store (Android)

1. Generate a signed keystore:
   ```bash
   keytool -genkey -v -keystore comfort-zone.keystore -alias comfortzone -keyalg RSA -keysize 2048 -validity 10000
   ```
2. In Android Studio: Build > Generate Signed Bundle (AAB)
3. Create a Google Play Console developer account ($25 one-time fee)
4. Upload the AAB to Google Play Console

### Apple App Store (iOS)

1. Requires macOS with Xcode
2. Enroll in Apple Developer Program ($99/year)
3. In Xcode: Archive > Distribute App > App Store Connect
4. Configure app metadata in App Store Connect
5. Submit for review

---

## Free Alternatives

- **Google Play**: $25 one-time registration fee
- **Apple App Store**: $99/year (required for iOS)
- **Alternative iOS distribution**: TestFlight (free, up to 10,000 testers), or use TWA as an alternative on iOS
- **Web App (PWA)**: Already works at `https://ssewasswa.onrender.com` — no app store needed!

---

## Project Structure (Mobile)

```
comfort-zone-mobile/
  capacitor.config.ts    — Capacitor configuration
  android/               — Android native project (generated)
  ios/                   — iOS native project (generated)
  package.json           — Node dependencies
  src/                   — Optional: custom native plugin code
```

---

## Summary

| Approach | Platform | Cost | Native Features | Best For |
|---|---|---|---|---|
| **PWA** | All (browser) | Free | Limited | Quickest deployment |
| **Electron** | Win/Mac/Linux | Free | Full | Desktop apps |
| **TWA** | Android only | $25 once | Limited | Simple Android wrapper |
| **Capacitor** | iOS + Android | $99-$125 | Full | Feature-rich mobile apps |

For Comfort Zone, the recommended path is:
1. **PWA** — Already live and working
2. **Electron** — Desktop wrapper (see `desktop-app/`)
3. **Capacitor** — Mobile apps with push notifications and native features
