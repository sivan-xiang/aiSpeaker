package com.readaloud.readaloud

import android.webkit.JavascriptInterface

/**
 * JS -> Native bridge. The web app (tts.js) calls these through `window.AndroidBridge`.
 * Each method bounces onto the UI thread and drives the MediaSession + foreground service.
 */
class WebAppInterface(private val activity: MainActivity) {

    @JavascriptInterface
    fun onTtsStart(title: String) {
        activity.runOnUiThread { activity.startPlayback(title) }
    }

    @JavascriptInterface
    fun onTtsStop() {
        activity.runOnUiThread { activity.stopPlayback() }
    }

    @JavascriptInterface
    fun onTtsPause() {
        activity.runOnUiThread { activity.pausePlayback() }
    }

    @JavascriptInterface
    fun onTtsResume() {
        activity.runOnUiThread { activity.resumePlayback() }
    }

    @JavascriptInterface
    fun setStatus(status: String) {
        // Reserved: mirror the web status text into the notification if desired later.
    }
}
