package com.comfortzone.app

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.view.Window
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.trusted.TrustedWebActivityBuilder
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

/**
 * MainActivity — Comfort Zone TWA Launcher
 *
 * This activity launches the Comfort Zone PWA (https://ssewasswa.onrender.com)
 * as a Trusted Web Activity (TWA). TWA uses Chrome's rendering engine,
 * so all PWA features work: offline mode, push notifications, service worker.
 *
 * This is the same approach used by:
 * - Twitter Lite
 * - Instagram Lite
 * - Pinterest
 * - Forbes
 * - Washington Post
 */
class MainActivity : AppCompatActivity() {

    private val LAUNCH_URL = "https://ssewasswa.onrender.com"

    @SuppressLint("MissingSuperCall")
    override fun onCreate(savedInstanceState: Bundle?) {
        // Install the Android 12+ splash screen
        val splashScreen = installSplashScreen()

        super.onCreate(savedInstanceState)

        // Keep screen on during splash loading
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Build the TWA intent
        val builder = TrustedWebActivityIntentBuilder(Uri.parse(LAUNCH_URL))

        // Set status bar and navigation bar colors
        builder.setNavigationBarColor(getColor(R.color.primary))
        builder.setNavigationBarDividerColor(getColor(R.color.primary_dark))

        // Dismiss splash screen when TWA is ready
        splashScreen.setKeepOnScreenCondition { true }

        try {
            // Try launching as a Trusted Web Activity first
            TrustedWebActivityBuilder(this)
                .build(builder)
                .launch(this)
        } catch (e: Exception) {
            // Fallback to Chrome Custom Tabs if TWA is not available
            // (this happens if assetlinks.json is not properly deployed)
            launchAsCustomTab()
        }
    }

    /**
     * Fallback: Launch in Chrome Custom Tabs if TWA verification fails.
     * This still provides a native-like experience with full-screen mode.
     */
    private fun launchAsCustomTab() {
        val customTabsIntent = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setNavigationBarColor(getColor(R.color.primary))
            .setNavigationBarDividerColor(getColor(R.color.primary_dark))
            .setColorScheme(CustomTabsIntent.COLOR_SCHEME_SYSTEM)
            .setUrlBarHidingEnabled(true)
            .build()

        customTabsIntent.launchUrl(this, Uri.parse(LAUNCH_URL))
    }

    /**
     * Handle incoming deep links / app links.
     * When a user clicks a link to ssewasswa.onrender.com, it opens in this app.
     */
    override fun onNewIntent(intent: android.content.Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)

        intent?.data?.let { uri ->
            try {
                val builder = TrustedWebActivityIntentBuilder(uri)
                TrustedWebActivityBuilder(this)
                    .build(builder)
                    .launch(this)
            } catch (e: Exception) {
                launchAsCustomTab()
            }
        }
    }
}
