package ru.semeinidispetcher.app

import ru.rustore.sdk.pushclient.messaging.model.RemoteMessage
import ru.rustore.sdk.pushclient.messaging.service.RuStoreMessagingService

/** Приём push RuStore: новый токен и сообщения о просьбах. */
class PushService : RuStoreMessagingService() {
    override fun onNewToken(token: String) {
        Store.setPushToken(this, token)
        // Приложение открыто — веб-часть сразу передаст новый токен на сервер
        MainActivity.current?.onPushToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data.isNotEmpty()) Notify.show(this, message.data)
    }
}
