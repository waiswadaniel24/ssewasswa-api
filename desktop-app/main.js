const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────
const APP_URL = 'https://ssewasswa.onrender.com';
const CUSTOM_USER_AGENT = 'ComfortZone-Desktop/1.0.0 (Electron; ' + process.platform + ')';
const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 900;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

let mainWindow = null;

// ─── Splash Screen Window ───────────────────────────────────────────────────
function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 500,
    height: 350,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Create inline splash screen HTML
  const splashHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
          color: #ffffff;
        }
        .app-icon {
          width: 80px; height: 80px;
          border-radius: 20px;
          background: linear-gradient(135deg, #e94560, #533483);
          display: flex; justify-content: center; align-items: center;
          font-size: 36px; font-weight: bold;
          margin-bottom: 20px;
          box-shadow: 0 8px 32px rgba(233, 69, 96, 0.3);
        }
        .app-name { font-size: 28px; font-weight: 600; margin-bottom: 8px; letter-spacing: 0.5px; }
        .app-tagline { font-size: 13px; color: #a0a0c0; margin-bottom: 30px; }
        .loader {
          width: 180px; height: 3px;
          background: rgba(255,255,255,0.1);
          border-radius: 2px; overflow: hidden;
        }
        .loader-bar {
          height: 100%; width: 0%;
          background: linear-gradient(90deg, #e94560, #533483);
          border-radius: 2px;
          animation: load 2.5s ease-in-out forwards;
        }
        @keyframes load {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="app-icon">CZ</div>
      <div class="app-name">Comfort Zone</div>
      <div class="app-tagline">Loading your workspace...</div>
      <div class="loader"><div class="loader-bar"></div></div>
    </body>
    </html>
  `;

  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHTML));
  return splash;
}

// ─── Main Application Window ─────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Comfort Zone',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    show: false,
    backgroundColor: '#1a1a2e'
  });

  // Set custom user agent
  mainWindow.webContents.setUserAgent(CUSTOM_USER_AGENT);

  // Set Content-Security-Policy headers
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; " +
          "style-src 'self' 'unsafe-inline' https:; " +
          "img-src 'self' data: blob: https: http:; " +
          "font-src 'self' data: https:; " +
          "connect-src 'self' https: wss:; " +
          "frame-src 'self' https:; " +
          "media-src 'self' https: blob:;"
        ]
      }
    });
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow navigation within the app's domain
    if (url.startsWith(APP_URL)) {
      mainWindow.loadURL(url);
      return { action: 'deny' };
    }
    // Open all other links in the system browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle navigation to external URLs within the window
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith('about:blank') && !url.startsWith('devtools:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Load the app URL
  mainWindow.loadURL(APP_URL);

  // Show window when ready, after splash disappears
  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      // Small delay for smooth transition
      setTimeout(() => {
        mainWindow.show();
        splashWindow.close();
        splashWindow = null;
      }, 500);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Application Menu ────────────────────────────────────────────────────────
function createAppMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : [{
      label: 'File',
      submenu: [
        { role: 'reload', label: 'Reload App' },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    }]),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          { role: 'startSpeaking' },
          { role: 'stopSpeaking' }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom', label: 'Reset Zoom' },
        { role: 'zoomIn', label: 'Zoom In', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Developer Tools' }
      ]
    },
    {
      label: 'History',
      submenu: [
        { role: 'reload', label: 'Reload Current Page' },
        { role: 'forceReload', label: 'Force Reload' },
        { type: 'separator' },
        { role: 'clearRecentHistory', label: 'Clear Browsing Data' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Visit Comfort Zone Online',
          click: () => shell.openExternal('https://ssewasswa.onrender.com')
        },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/ssewasswa/comfort-zone/issues')
        },
        { type: 'separator' },
        {
          label: 'About Comfort Zone',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Comfort Zone',
              message: 'Comfort Zone Desktop v1.0.0',
              detail: 'Comfort Zone is a comprehensive management platform for schools, churches, businesses, and healthcare providers.\n\nBuilt with Electron\nPlatform: ' + process.platform + '\nArchitecture: ' + process.arch
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── IPC Handlers (via preload bridge) ──────────────────────────────────────
ipcMain.handle('get-app-info', () => ({
  name: 'Comfort Zone Desktop',
  version: app.getVersion(),
  electronVersion: process.versions.electron,
  platform: process.platform,
  arch: process.arch,
  appUrl: APP_URL
}));

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

// ─── App Lifecycle ───────────────────────────────────────────────────────────
let splashWindow = null;

app.whenReady().then(() => {
  createAppMenu();
  splashWindow = createSplashWindow();

  // Short delay before creating main window for splash display
  setTimeout(() => {
    createMainWindow();
  }, 300);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    splashWindow = createSplashWindow();
    setTimeout(() => {
      createMainWindow();
    }, 300);
  } else {
    mainWindow.show();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) {
      if (mainWindow) mainWindow.loadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
