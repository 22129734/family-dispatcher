package ru.semeinidispetcher.app

import android.webkit.JavascriptInterface

/**
 * window.DispatcherApp в веб-части. Работает только для страниц нашего сайта:
 * чужие сайты в окне приложения не открываются, а мост проверяет адрес страницы.
 */
class Bridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    /** Push-токен RuStore этого телефона; пусто — push недоступен (нет RuStore и т. п.). */
    @JavascriptInterface
    fun pushToken(): String = if (activity.trustedPage) Store.pushToken(activity).orEmpty() else ""

    /** "on" | "ask" | "unavailable" */
    @JavascriptInterface
    fun notificationsState(): String = activity.notificationsState()

    /** По нажатию «Включить уведомления»: ответ придёт в dispatcherNative.onNotifications. */
    @JavascriptInterface
    fun requestNotifications() {
        if (activity.trustedPage) activity.requestNotifications()
    }

    /** Системный голосовой ввод: текст придёт в dispatcherNative.onVoice. */
    @JavascriptInterface
    fun startVoice() {
        if (activity.trustedPage) activity.startVoice()
    }

    /** Снимок дел для офлайн-экрана. */
    @JavascriptInterface
    fun saveSnapshot(json: String) {
        if (activity.trustedPage) Store.saveSnapshot(activity, json)
    }

    /** Выход из аккаунта: забыть дела этого человека на телефоне. */
    @JavascriptInterface
    fun clearSnapshot() {
        if (activity.trustedPage) Store.clearSnapshot(activity)
    }
}
