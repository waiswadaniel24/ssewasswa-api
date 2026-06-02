# Comfort Zone — Desktop Application

A native desktop wrapper for the **Comfort Zone** platform, built with [Electron](https://www.electronjs.org/). Wraps the PWA at `https://ssewasswa.onrender.com` as a standalone desktop application for **Windows**, **macOS**, and **Linux**.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18.x or later |
| npm | 9.x or later |
| Git | For cloning the repo |

> **Note:** You do **NOT** need to install Electron globally. It is installed as a devDependency.

---

## Installation

```bash
# 1. Clone the repository (or navigate to the desktop-app folder)
cd desktop-app/

# 2. Install dependencies
npm install
```

> First-time install downloads the Electron binary (~80-150 MB depending on platform). This is normal.

---

## Development

Run the app in development mode:

```bash
npm start
```

This opens the Comfort Zone app in an Electron window with:
- Custom user agent (`ComfortZone-Desktop/1.0.0`)
- Content Security Policy headers
- External links opened in the system browser
- Splash screen on startup
- Application menu (File, Edit, View, History, Help)

---

## Building for Production

### Build for your current platform

```bash
npm run build
```

### Build for specific platforms

```bash
# Windows (.exe installer)
npm run build-win

# macOS (.dmg)
npm run build-mac

# Linux (.AppImage)
npm run build-linux
```

### Output

Built files are saved to `desktop-app/dist/`. The output varies by platform:

| Platform | Output | Format |
|---|---|---|
| Windows | `Comfort Zone Setup X.X.X.exe` | NSIS installer |
| macOS | `Comfort Zone-X.X.X.dmg` | Disk image |
| Linux | `Comfort Zone-X.X.X.AppImage` | AppImage |

### Cross-Platform Builds

Cross-platform builds are supported but require additional setup:
- **Windows builds from macOS/Linux**: Install `wine`
- **macOS builds from Windows/Linux**: Not supported (use GitHub Actions or a Mac)
- **Linux builds from Windows/macOS**: Usually works out of the box

The recommended approach is to use **GitHub Actions** (see below) which provides free build environments for all platforms.

---

## Code Signing (FREE for Open Source)

### Windows — Azure SignTool (Free)

1. Get a **free code signing certificate** from [Azure Key Vault](https://azure.microsoft.com/en-us/services/key-vault/) for open-source projects
2. Use [Azure SignTool](https://github.com/vcsjones/AzureSignTool) to sign your `.exe`
3. Add to your build script:

```bash
npx azuresigntool sign \
  --key-vault-url "YOUR_KEY_VAULT_URL" \
  --certificate-name "YOUR_CERT_NAME" \
  --azure-client-id "YOUR_CLIENT_ID" \
  --azure-client-secret "YOUR_CLIENT_SECRET" \
  --azure-tenant-id "YOUR_TENANT_ID" \
  dist/Comfort\ Zone\ Setup.exe
```

### macOS — Free Developer Certificate

1. Enroll in the [Apple Developer Program](https://developer.apple.com/) (free tier works)
2. Generate a developer ID certificate in Xcode
3. Configure in `package.json`:

```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "entitlements": "entitlements.mac.plist",
      "entitlementsInherit": "entitlements.mac.plist"
    }
  }
}
```

### Linux — No Signing Required

Linux AppImages do not require code signing. Users can verify integrity via SHA256 checksums.

---

## Distribution

### GitHub Releases (Recommended — FREE)

1. Push a version tag: `git tag v1.0.0 && git push --tags`
2. GitHub Actions automatically builds for all 3 platforms (see `GITHUB_ACTIONS_BUILD.yml`)
3. Artifacts are uploaded to the GitHub Release page
4. Users download directly from: `https://github.com/YOUR_USER/comfort-zone/releases`

### Website Download

Upload the built installers to your website:

```
/downloads/
  /comfort-zone-latest-win.exe
  /comfort-zone-latest-mac.dmg
  /comfort-zone-latest-linux.AppImage
  /SHA256SUMS
```

Provide SHA256 checksums so users can verify downloads.

---

## Auto-Update (Optional)

To enable automatic updates, add [electron-updater](https://www.electron.build/auto-update):

```bash
npm install electron-updater
```

Add to `main.js`:

```javascript
const { autoUpdater } = require('electron-updater');

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
});
```

Configure a update server (GitHub Releases works for free, or use a dedicated update server).

---

## Project Structure

```
desktop-app/
  main.js              — Electron main process
  preload.js           — Security preload script (context bridge)
  package.json          — Dependencies and build config
  icon.png             — App icon (512x512 recommended)
  .gitignore           — Files to ignore in git
  GITHUB_ACTIONS_BUILD.yml — CI/CD workflow for auto-building
  README.md            — This file
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `npm install` fails | Ensure Node.js 18+ is installed. Try `npm cache clean --force` then retry. |
| App shows blank screen | Check internet connection. The app loads from `https://ssewasswa.onrender.com`. |
| External links don't open | Check system default browser settings. |
| Build fails on macOS | Ensure Xcode Command Line Tools are installed: `xcode-select --install` |
| Windows SmartScreen warning | Use code signing to eliminate this warning (see above). |
| "app not verified" on macOS | Use a Developer ID certificate or tell users to right-click > Open. |

---

## License

Same license as the main Comfort Zone project.
