# Add project specific ProGuard rules here.

# TWA - Trusted Web Activity (Chrome Custom Tabs)
-keep class androidx.browser.trusted.** { *; }
-keepclassmembers class androidx.browser.trusted.** { *; }

# Keep the launch URL build config fields
-keepclassmembers class com.comfortzone.app.BuildConfig { *; }
