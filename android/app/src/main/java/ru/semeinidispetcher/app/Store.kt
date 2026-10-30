package ru.semeinidispetcher.app

import android.content.Context
import java.io.File

/** Что приложение помнит между запусками: push-токен и снимок дел для офлайн-экрана. */
object Store {
    private const val PREFS = "dispatcher"
    private const val KEY_TOKEN = "push_token"
    private const val SNAPSHOT = "tasks_snapshot.json"
    private const val SNAPSHOT_MAX = 256 * 1024

    fun pushToken(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TOKEN, null)

    fun setPushToken(context: Context, token: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_TOKEN, token).apply()
    }

    /** Снимок дел приходит из веб-части после каждого обновления списка. */
    fun saveSnapshot(context: Context, json: String) {
        if (json.length > SNAPSHOT_MAX) return
        File(context.filesDir, SNAPSHOT).writeText(json)
    }

    fun snapshot(context: Context): String? {
        val file = File(context.filesDir, SNAPSHOT)
        return if (file.exists()) file.readText() else null
    }

    /** Выход из аккаунта: дела этого человека на телефоне больше не показываем. */
    fun clearSnapshot(context: Context) {
        File(context.filesDir, SNAPSHOT).delete()
    }
}
