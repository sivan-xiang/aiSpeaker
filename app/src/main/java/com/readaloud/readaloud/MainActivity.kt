package com.readaloud.readaloud

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.media.session.MediaMetadataCompat
import androidx.media.session.MediaSessionCompat
import androidx.media.session.PlaybackStateCompat
import com.readaloud.readaloud.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var webView: WebView
    private lateinit var mediaSession: MediaSessionCompat
    private var lastTitle: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        createNotificationChannel()
        requestNotificationPermission()

        webView = binding.webview
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            // Kokoro model + kokoro-js are fetched from a CDN on first launch.
            setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW)
            // Let audio play without an explicit gesture in case the flag matters on some ROMs.
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString ReadAloudShell/0.1"
        }
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        // Bridge so the in-WebView Kokoro TTS can drive the system media notification.
        webView.addJavascriptInterface(WebAppInterface(this), "AndroidBridge")

        initMediaSession()

        // Load the local web app (which runs Kokoro entirely on-device via the browser engine).
        webView.loadUrl("file:///android_asset/index.html")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "朗读播放",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "朗读壳后台播放通知"
                setShowBadge(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    REQ_NOTIF
                )
            }
        }
    }

    private fun initMediaSession() {
        mediaSession = MediaSessionCompat(this, "ReadAloud")
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        )
        mediaSession.setCallback(object : MediaSessionCompat.Callback() {
            // Driven by the notification's media buttons / headset keys.
            override fun onPlay() {
                runOnUiThread { webView.evaluateJavascript("window.__ttsResume && window.__ttsResume()", null) }
            }
            override fun onPause() {
                runOnUiThread { webView.evaluateJavascript("window.__ttsPause && window.__ttsPause()", null) }
            }
            override fun onStop() {
                runOnUiThread { webView.evaluateJavascript("window.__ttsStop && window.__ttsStop()", null) }
            }
        })
        mediaSession.isActive = true
        updatePlaybackState(PlaybackStateCompat.STATE_NONE, "")
    }

    fun updatePlaybackState(state: Int, title: String) {
        if (title.isNotEmpty()) lastTitle = title
        val actions = when (state) {
            PlaybackStateCompat.STATE_PLAYING ->
                PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_STOP
            PlaybackStateCompat.STATE_PAUSED ->
                PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_STOP
            else ->
                PlaybackStateCompat.ACTION_PLAY
        }
        val psBuilder = PlaybackStateCompat.Builder()
            .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1.0f)
            .setActions(actions)
        mediaSession.setPlaybackState(psBuilder.build())

        val meta = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, if (title.isNotEmpty()) title else "朗读壳")
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "Kokoro 本地朗读")
            .build()
        mediaSession.setMetadata(meta)
    }

    fun startPlayback(title: String) {
        updatePlaybackState(PlaybackStateCompat.STATE_PLAYING, title)
        val intent = Intent(this, PlaybackService::class.java).apply {
            putExtra("title", title)
            putExtra("state", PlaybackStateCompat.STATE_PLAYING)
            putExtra("token", mediaSession.sessionToken)
        }
        ContextCompat.startForegroundService(this, intent)
    }

    fun pausePlayback() {
        updatePlaybackState(PlaybackStateCompat.STATE_PAUSED, lastTitle)
        val intent = Intent(this, PlaybackService::class.java).apply {
            putExtra("title", lastTitle)
            putExtra("state", PlaybackStateCompat.STATE_PAUSED)
            putExtra("token", mediaSession.sessionToken)
        }
        // Re-post with the paused state so the notification swaps Pause -> Play.
        ContextCompat.startForegroundService(this, intent)
    }

    fun resumePlayback() {
        updatePlaybackState(PlaybackStateCompat.STATE_PLAYING, lastTitle)
        val intent = Intent(this, PlaybackService::class.java).apply {
            putExtra("title", lastTitle)
            putExtra("state", PlaybackStateCompat.STATE_PLAYING)
            putExtra("token", mediaSession.sessionToken)
        }
        ContextCompat.startForegroundService(this, intent)
    }

    fun stopPlayback() {
        updatePlaybackState(PlaybackStateCompat.STATE_NONE, "")
        stopService(Intent(this, PlaybackService::class.java))
    }

    override fun onDestroy() {
        stopPlayback()
        mediaSession.release()
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    companion object {
        const val NOTIF_ID = 1001
        const val CHANNEL_ID = "readaloud_playback"
        private const val REQ_NOTIF = 100
    }
}
