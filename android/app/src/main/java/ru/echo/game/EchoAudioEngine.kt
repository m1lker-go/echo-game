package ru.echo.game

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.SoundPool
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Android equivalent of client/music-manager.js + client/audio-settings.js.
 * Owns the five existing ECHO songs only while native pages are showing;
 * the game's WebView continues to use its original web audio engine.
 */
internal class EchoAudioEngine(private val context: Context) {
    private val preferences = context.getSharedPreferences("echo.android.preferences", Context.MODE_PRIVATE)
    var language by mutableStateOf(preferences.getString("language", "ru") ?: "ru")
        private set
    var musicVolume by mutableFloatStateOf(preferences.getFloat("musicVolume", .6f).coerceIn(0f, 1f))
        private set
    var sfxVolume by mutableFloatStateOf(preferences.getFloat("sfxVolume", .7f).coerceIn(0f, 1f))
        private set

    private val songs = intArrayOf(
        R.raw.musicgame001, R.raw.musicgame002, R.raw.musicgame003,
        R.raw.musicgame004, R.raw.musicgame005
    )
    private var songIndex = preferences.getInt("songIndex", 0).coerceIn(0, songs.lastIndex)
    private var songPosition = preferences.getInt("songPosition", 0).coerceAtLeast(0)
    private var player: MediaPlayer? = null
    private var foreground = false
    private var webActive = false
    private var released = false

    private val soundPool = SoundPool.Builder()
        .setMaxStreams(4)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        ).build()
    private val clickId = soundPool.load(context, R.raw.echo_click, 1)

    private fun ensureSong() {
        if (player != null || released) return
        player = MediaPlayer.create(context, songs[songIndex])?.apply {
            setOnCompletionListener { nextSong() }
            setOnErrorListener { _, _, _ ->
                nextSong()
                true
            }
            if (songPosition > 0) {
                runCatching { seekTo(songPosition) }
                songPosition = 0
            }
            setVolume(musicVolume, musicVolume)
        }
    }

    private fun nextSong() {
        runCatching { player?.release() }
        player = null
        songIndex = (songIndex + 1) % songs.size
        songPosition = 0
        preferences.edit().putInt("songIndex", songIndex).putInt("songPosition", 0).apply()
        updatePlayback()
    }

    private fun updatePlayback() {
        if (released) return
        if (!foreground || webActive || musicVolume <= 0f) {
            player?.let {
                if (it.isPlaying) runCatching { it.pause() }
                songPosition = runCatching { it.currentPosition }.getOrDefault(songPosition)
            }
            return
        }
        ensureSong()
        player?.let {
            it.setVolume(musicVolume, musicVolume)
            if (!it.isPlaying) runCatching { it.start() }
        }
    }

    fun setForeground(active: Boolean) {
        foreground = active
        updatePlayback()
        if (!active) savePosition()
    }

    fun setWebActive(active: Boolean) {
        webActive = active
        updatePlayback()
    }

    fun setMusicVolume(volume: Float) {
        musicVolume = volume.coerceIn(0f, 1f)
        preferences.edit().putFloat("musicVolume", musicVolume).apply()
        player?.setVolume(musicVolume, musicVolume)
        updatePlayback()
    }

    fun setSfxVolume(volume: Float) {
        sfxVolume = volume.coerceIn(0f, 1f)
        preferences.edit().putFloat("sfxVolume", sfxVolume).apply()
    }

    fun setLanguage(value: String) {
        if (value != "ru" && value != "en") return
        language = value
        preferences.edit().putString("language", value).apply()
    }

    fun click() {
        if (!released && foreground && sfxVolume > 0f) {
            soundPool.play(clickId, sfxVolume, sfxVolume, 1, 0, 1f)
        }
    }

    private fun savePosition() {
        preferences.edit()
            .putInt("songIndex", songIndex)
            .putInt("songPosition", songPosition)
            .apply()
    }

    fun release() {
        if (released) return
        setForeground(false)
        released = true
        runCatching { player?.release() }
        player = null
        soundPool.release()
    }
}
