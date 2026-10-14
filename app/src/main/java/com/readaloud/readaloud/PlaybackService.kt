package com.readaloud.readaloud

import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.media.session.MediaButtonReceiver
import androidx.media.session.MediaSessionCompat
import androidx.media.session.PlaybackStateCompat

/**
 * Foreground service that hosts the media-style notification while Kokoro reads aloud
 * inside the WebView. The actual audio is synthesised in the WebView; this service only
 * (a) keeps the process alive in the background and (b) shows a system media notification
 * with play/pause/stop wired to the MediaSession callback -> WebView JS.
 */
class PlaybackService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra("title") ?: "朗读中"
        val state = intent?.getIntExtra("state", PlaybackStateCompat.STATE_PLAYING)
            ?: PlaybackStateCompat.STATE_PLAYING

        val token: MediaSessionCompat.Token? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent?.getParcelableExtra("token", MediaSessionCompat.Token::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra("token") as? MediaSessionCompat.Token
        }

        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, MainActivity.CHANNEL_ID)
            .setContentTitle(title)
            .setContentText("Kokoro 本地朗读")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setCategory(NotificationCompat.CATEGORY_MEDIA)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(state != PlaybackStateCompat.STATE_NONE)

        if (token != null) {
            builder.setStyle(
                NotificationCompat.MediaStyle()
                    .setMediaSession(token)
                    .setShowActionsInCompactView(0, 1)
            )
            val pauseAction = NotificationCompat.Action(
                android.R.drawable.ic_media_pause,
                "暂停",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PAUSE)
            )
            val playAction = NotificationCompat.Action(
                android.R.drawable.ic_media_play,
                "播放",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY)
            )
            val stopAction = NotificationCompat.Action(
                android.R.drawable.ic_menu_close_clear_cancel,
                "停止",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP)
            )
            if (state == PlaybackStateCompat.STATE_PLAYING) {
                builder.addAction(pauseAction)
                builder.addAction(stopAction)
            } else {
                builder.addAction(playAction)
                builder.addAction(stopAction)
            }
        }

        startForeground(MainActivity.NOTIF_ID, builder.build())
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopForeground(true)
        super.onDestroy()
    }
}
