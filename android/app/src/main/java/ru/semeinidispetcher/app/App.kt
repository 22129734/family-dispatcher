package ru.semeinidispetcher.app

import android.app.Application
import android.util.Log
import ru.rustore.sdk.pushclient.RuStorePushClient

/**
 * Запуск приложения: канал уведомлений и RuStore Push.
 *
 * Push работает через RuStore (или другое приложение VK — «дистрибьютор»). Без ID проекта
 * в сборке push просто выключен, остальное приложение работает.
 */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Notify.ensureChannel(this)
        val projectId = BuildConfig.RUSTORE_PUSH_PROJECT_ID
        if (projectId.isEmpty()) return
        try {
            RuStorePushClient.init(this, projectId)
            RuStorePushClient.getToken()
                .addOnSuccessListener { token -> Store.setPushToken(this, token) }
                .addOnFailureListener { error -> Log.w(TAG, "Push-токен не получен", error) }
        } catch (error: Exception) {
            // Нет RuStore на телефоне и т. п. — приложение работает и без push
            Log.w(TAG, "RuStore Push не запустился", error)
        }
    }

    companion object {
        const val TAG = "Dispatcher"
    }
}
