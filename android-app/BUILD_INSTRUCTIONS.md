# 📱 Comfort Zone — TWA Android APK Build Instructions

This guide walks you through building the Comfort Zone Android app from source using the **Trusted Web Activity (TWA)** wrapper approach. TWA is Google's recommended, 100% FREE way to wrap a PWA into a real Android APK.

**Used by**: Twitter Lite, Instagram Lite, Pinterest, Forbes, Washington Post

---

## Prerequisites

| Tool | Version | Cost |
|------|---------|------|
| Android Studio | Latest (2024.x) | FREE |
| JDK (Java Development Kit) | 17+ | FREE (bundled with Android Studio) |
| Android SDK | API 34 | FREE (bundled with Android Studio) |
| Git | Any | FREE |

---

## Step 1: Install Android Studio (FREE)

1. Download Android Studio from: https://developer.android.com/studio
2. Install it (follow the setup wizard)
3. During setup, let it download:
   - Android SDK Platform 34 (API 34)
   - Android SDK Build-Tools
   - Android SDK Platform-Tools

---

## Step 2: Get the SHA-256 Fingerprint

You need your app signing key's SHA-256 fingerprint for the `assetlinks.json` file.

### Option A: Debug Keystore (for testing)

Android Studio creates a debug keystore automatically. To get its fingerprint:

```bash
# On macOS/Linux
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android

# On Windows
keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android
```

Look for the line that says `SHA256:` and copy the hex string (without colons).

### Option B: Release Keystore (for Play Store)

```bash
# First, generate a release keystore (one-time):
keytool -genkeypair -v -keystore comfortzone-release.keystore -alias comfortzone -keyalg RSA -keysize 2048 -validity 10000

# Then get the fingerprint:
keytool -list -v -keystore comfortzone-release.keystore -alias comfortzone
```

**IMPORTANT**: Keep your `.keystore` file safe and backed up! You can NEVER re-upload to the Play Store with a different key.

---

## Step 3: Configure assetlinks.json

1. Open `android-app/assetlinks.json` (and `public/.well-known/assetlinks.json`)
2. Replace `YOUR_SHA256_FINGERPRINT_HERE` with your actual SHA-256 fingerprint:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.comfortzone.app",
    "sha256_cert_fingerprints": [
      "14:6D:E9:83:C5:22:0A:B2:AA:F4:DE:A5:44:EB:C2:17:9A:31:4D:4B:B8:39:3F:A2:76:E0:8B:48:11:F6:40:1B:9E"
    ]
  }
}]
```

3. Deploy the updated file to your server:
   - The server already serves it at `/.well-known/assetlinks.json`
   - After updating the file in `public/.well-known/assetlinks.json`, redeploy your app on Render
   - Verify it's accessible: `curl https://ssewasswa.onrender.com/.well-known/assetlinks.json`

### Test Digital Asset Links

Use Google's testing tool: https://developers.google.com/digital-asset-links/tools/generator
- Enter your site domain: `ssewasswa.onrender.com`
- Enter your app package name: `com.comfortzone.app`
- Enter your SHA-256 fingerprint
- Click "Test" — it should show ✅ Success

---

## Step 4: Build the APK with Android Studio

### 4a: Open the Project

1. Launch Android Studio
2. Click **File → Open**
3. Navigate to and select the `android-app/` directory
4. Wait for Gradle to sync (first time may take 5-10 minutes)

### 4b: Build a Debug APK (for testing)

1. In Android Studio menu: **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. The debug APK will be at: `android-app/app/build/outputs/apk/debug/app-debug.apk`
3. Transfer this APK to an Android phone to test

### 4c: Build a Signed Release APK (for Play Store)

1. **Generate a keystore** (if you haven't already — see Step 2B)
2. In Android Studio: **Build → Generate Signed Bundle / APK**
3. Select **APK** (not Android App Bundle for now — APK is simpler for first upload)
4. Click **Create new...** or select your existing keystore
5. Fill in:
   - Key store path: path to your `.keystore` file
   - Key store password: (your password)
   - Key alias: `comfortzone`
   - Key password: (your password)
6. Select **release** build variant
7. Click **Create**
8. The signed APK will be at: `android-app/app/build/outputs/apk/release/app-release.apk`

### 4d: Configure Signing in build.gradle (optional but recommended)

Add this to `app/build.gradle` inside the `android { }` block:

```groovy
android {
    // ... existing config ...

    signingConfigs {
        release {
            storeFile file('../comfortzone-release.keystore')
            storePassword 'your_store_password'
            keyAlias 'comfortzone'
            keyPassword 'your_key_password'
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
            // ... existing config ...
        }
    }
}
```

**Better**: Store passwords in `local.properties` (NOT in version control):
```properties
STORE_PASSWORD=your_store_password
KEY_PASSWORD=your_key_password
```

Then reference them in `build.gradle`:
```groovy
def localProps = new Properties()
def localPropsFile = rootProject.file('local.properties')
if (localPropsFile.exists()) localPropsFile.withReader('UTF-8') { reader -> localProps.load(reader) }

signingConfigs {
    release {
        storeFile file('../comfortzone-release.keystore')
        storePassword localProps.getProperty('STORE_PASSWORD', '')
        keyAlias 'comfortzone'
        keyPassword localProps.getProperty('KEY_PASSWORD', '')
    }
}
```

---

## Step 5: Upload to Google Play Store (FREE Developer Account)

### 5a: Create a Google Play Developer Account

1. Go to: https://play.google.com/console
2. Click **Create account**
3. Pay the one-time $25 registration fee (this is the ONLY cost ever)
4. Complete your developer profile

### 5b: Create an App Listing

1. In the Play Console, click **Create app**
2. Fill in:
   - **App name**: Comfort Zone
   - **Default language**: English
   - **App type**: Apps
   - **Free or Paid**: Free
3. Select **App alerts → None**

### 5c: Set Up App Content

1. **App access**: Not available on children under 13
2. **Advertising ID**: Yes, use advertising ID
3. **App content**: Business, Education, Productivity
4. **Target audience**: All ages
5. **Privacy policy**: Point to your website's privacy policy

### 5d: Upload the APK

1. Go to **Release → Production → Create new release**
2. Upload your signed `app-release.apk`
3. Add release notes (e.g., "Version 1.1.0 - Initial TWA release")

### 5e: Set Up Store Listing

1. **Description**: Add your app description
2. **Screenshots**: Take screenshots from an Android device
3. **Icon**: Use your app icon (512x512 PNG)
4. **Feature graphic**: 1024x500 banner
5. **Category**: Business or Education

### 5f: Submit for Review

1. Click **Review release**
2. Fix any warnings
3. Click **Start rollout to Production**

Google typically reviews within 1-7 days. After approval, your app will be live on the Play Store!

---

## Alternative: Build Using GitHub Actions (FREE CI/CD)

You can automate the build process using GitHub Actions — completely FREE for public repositories.

### Create `.github/workflows/build-android.yml`:

```yaml
name: Build Android APK

on:
  push:
    tags:
      - 'v*'  # Trigger on version tags like v1.1.0
  workflow_dispatch:  # Also allow manual triggers

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Grant execute permission for gradlew
        run: chmod +x android-app/gradlew

      - name: Build Debug APK
        run: cd android-app && ./gradlew assembleDebug

      - name: Upload Debug APK
        uses: actions/upload-artifact@v4
        with:
          name: comfortzone-debug-apk
          path: android-app/app/build/outputs/apk/debug/app-debug.apk

      # For signed release, add keystore as GitHub Secrets:
      # - KEYSTORE_BASE64 (base64 encoded .keystore file)
      # - KEYSTORE_PASSWORD
      # - KEY_ALIAS
      # - KEY_PASSWORD
```

---

## Troubleshooting

### TWA Shows Browser Chrome Instead of Full Screen
- **Cause**: `assetlinks.json` is not properly deployed or the SHA-256 fingerprint is wrong
- **Fix**: 
  1. Verify the file is accessible: `curl https://ssewasswa.onrender.com/.well-known/assetlinks.json`
  2. Use Google's Digital Asset Links tool to test
  3. Make sure the SHA-256 fingerprint matches your signing key

### Build Fails with "SDK not found"
- **Fix**: Open SDK Manager in Android Studio → Install Android SDK Platform 34

### App Crashes on Old Android Phones
- **Fix**: The minSdk is 21 (Android 5.0 Lollipop). If you need older support, lower it to 19 (KitKat), but TWA works best on 21+.

### assetlinks.json Returns 404
- **Fix**: Make sure the file exists at `public/.well-known/assetlinks.json` and the server route is added (already done in server.js)

---

## Quick Reference

| What | Command / URL |
|------|--------------|
| Build debug APK | Android Studio → Build → Build APK |
| Build release APK | Android Studio → Build → Generate Signed APK |
| Get SHA-256 | `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android` |
| Test asset links | https://developers.google.com/digital-asset-links/tools/generator |
| Verify assetlinks | `curl https://ssewasswa.onrender.com/.well-known/assetlinks.json` |
| Play Console | https://play.google.com/console |
