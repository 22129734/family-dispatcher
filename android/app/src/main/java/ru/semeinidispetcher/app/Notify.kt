package ru.semeinidispetcher.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray

/**
 * Уведомления о просьбах с кнопками «Беру» / «Не могу» / «Сделано» / «Я помню».
 *
 * Сервер присылает только data (заголовок, текст, адрес дела, подписанную ссылку действия).
 * Кнопки отвечают по этой ссылке без входа — как кнопки уведомлений веб-версии.
 */
object Notify {
    const val EXTRA_OPEN_URL = "open_url"

    fun ensureChannel(context: Context) {
        val channel = NotificationChannel(
            context.getString(R.string.channel_requests),
            context.getString(R.string.channel_requests_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply { description = context.getString(R.string.channel_requests_description) }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun canNotify(context: Context): Boolean {
        val granted = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        return granted && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun idFor(tag: String): Int = tag.hashCode()

    /** Открыть дело в приложении по нажатию на уведомление. */
    fun openIntent(context: Context, url: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(EXTRA_OPEN_URL, url)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    @SuppressLint("MissingPermission") // проверяем canNotify()
    fun show(context: Context, data: Map<String, String>) {
        if (!canNotify(context)) return
        val title = data["title"].orEmpty()
        if (title.isEmpty()) return
        val body = data["body"].orEmpty()
        val url = data["url"].takeUnless { it.isNullOrEmpty() } ?: "/"
        val tag = data["tag"].takeUnless { it.isNullOrEmpty() } ?: url
        val actUrl = data["act_url"].orEmpty()
        val id = idFor(tag)

        val builder = base(context, title, body)
            .setContentIntent(openIntent(context, url, id))

        val actions = try {
            JSONArray(data["actions"] ?: "[]")
        } catch (_: Exception) {
            JSONArray()
        }
        for (i in 0 until actions.length()) {
            val item = actions.optJSONObject(i) ?: continue
            val action = item.optString("action")
            val label = item.optString("title")
            if (action.isEmpty() || label.isEmpty()) continue
            val pending = if (action == "decline" || actUrl.isEmpty()) {
                // Причину отказа удобнее написать на странице дела
                val target = if (action == "decline") url + (if ("?" in url) "&" else "?") + "decline=1" else url
                openIntent(context, target, id * 10 + i)
            } else {
                val intent = Intent(context, ActionReceiver::class.java)
                    .putExtra(ActionReceiver.EXTRA_ACT_URL, actUrl)
                    .putExtra(ActionReceiver.EXTRA_ACTION, action)
                    .putExtra(ActionReceiver.EXTRA_TAG, tag)
                    .putExtra(ActionReceiver.EXTRA_URL, url)
                PendingIntent.getBroadcast(
                    context,
                    id * 10 + i,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }
            builder.addAction(0, label, pending)
        }
        NotificationManagerCompat.from(context).notify(id, builder.build())
    }

    /** Ответ из уведомления принят — заменить уведомление коротким подтверждением. */
    @SuppressLint("MissingPermission")
    fun confirm(context: Context, tag: String, title: String, body: String, url: String) {
        if (!canNotify(context)) return
        val id = idFor(tag)
        val builder = base(context, title, body)
            .setSilent(true)
            .setTimeoutAfter(10_000)
            .setContentIntent(openIntent(context, url, id))
        NotificationManagerCompat.from(context).notify(id, builder.build())
    }

    private fun base(context: Context, title: String, body: String): NotificationCompat.Builder =
        NotificationCompat.Builder(context, context.getString(R.string.channel_requests))
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.accent))
            .setContentTitle(title)
            .setContentText(body.lineSequence().firstOrNull().orEmpty())
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
}
