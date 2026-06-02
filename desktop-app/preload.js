const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script for Comfort Zone Desktop.
 *
 * This script runs in a sandboxed context before the web page loads.
 * It uses Electron's contextBridge to expose a minimal, safe API
 * to the renderer (web page) process.
 *
 * SECURITY PRINCIPLES:
 * - No direct access to Node.js APIs (nodeIntegration: false)
 * - No access to require() or __dirname
 * - All IPC communication goes through validated channels
 * - No raw ipcRenderer exposed — only whitelisted methods
 */

contextBridge.exposeInMainWorld('comfortZoneDesktop', {
  /**
   * Get application metadata (version, platform, etc.)
   * @returns {Promise<Object>} App info object
   */
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  /**
   * Open a URL in the system's default browser
   * @param {string} url - The URL to open externally
   */
  openExternal: (url) => {
    // Validate URL format before sending to main process
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
        ipcRenderer.invoke('open-external', url);
      } else {
        console.warn('Blocked external navigation to unsupported protocol:', parsed.protocol);
      }
    } catch (e) {
      console.warn('Invalid URL passed to openExternal:', url);
    }
  },

  /**
   * Check if running inside Electron desktop wrapper
   * @returns {boolean} Always true in this context
   */
  isDesktop: () => true
});
