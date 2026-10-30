package ru.semeinidispetcher.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Кнопки «Беру» / «Сделано» / «Я помню» прямо в уведомлении — без открытия приложения.
 * Ответ уходит по подписанной ссылке действия (HMAC, привязана к делу и человеку).
 */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val actUrl = intent.getStringExtra(EXTRA_ACT_URL) ?: return
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return
        val tag = intent.getStringExtra(EXTRA_TAG) ?: return
        val url = intent.getStringExtra(EXTRA_URL) ?: "/"
        val app = context.applicationContext
        val pending = goAsync()
        thread {
            try {
                val title = send(actUrl, action)
                val confirmation = when (action) {
                    "accept" -> R.string.action_done_accept
                    "remember" -> R.string.action_done_remember
                    else -> R.string.action_done_done
                }
                Notify.confirm(app, tag, app.getString(confirmation), title, url)
            } catch (error: Exception) {
                Log.w(App.TAG, "Ответ из уведомления не отправлен", error)
                Notify.confirm(app, tag, app.getString(R.string.action_failed), "", url)
            } finally {
                pending.finish()
            }
        }
    }

    /** POST {act_url}/{action}; возвращает название дела из ответа. */
    private fun send(actUrl: String, action: String): String {
        val connection = URL("${BuildConfig.BASE_URL}$actUrl/$action").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Accept", "application/json")
            val code = connection.responseCode
            if (code !in 200..299) error("HTTP $code")
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            return JSONObject(body).optJSONObject("task")?.optString("title").orEmpty()
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        const val EXTRA_ACT_URL = "act_url"
        const val EXTRA_ACTION = "action"
        const val EXTRA_TAG = "tag"
        const val EXTRA_URL = "url"
    }
}
