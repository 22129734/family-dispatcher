package ru.semeinidispetcher.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognizerIntent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

/**
 * Главный экран: веб-версия «Семейного диспетчера» в WebView — без адресной строки и меню
 * браузера (п. 8.2 правил RuStore), плюс то, чего нет у сайта: push RuStore с ответом
 * из уведомления, офлайн-экран с сохранёнными делами, «Поделиться» и системный голосовой ввод.
 */
class MainActivity : ComponentActivity() {
    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private var offline: OfflineView? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingMic: PermissionRequest? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    /** Мост открыт только страницам нашего сайта. */
    @Volatile
    var trustedPage = false
        private set

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    private val recognizeSpeech = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        callWeb("onVoice", text)
    }

    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingMic?.let { if (granted) it.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else it.deny() }
        pendingMic = null
    }

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        callWeb("onNotifications", notificationsState())
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this

        root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        // Android 15 рисует под системными панелями — отступаем от них и от клавиатуры
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(false)
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString SemeiniDispetcherApp/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        web.addJavascriptInterface(Bridge(this), "DispatcherApp")
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, _, _, _, _ -> openOutside(Uri.parse(url)) }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (offline == null && web.canGoBack()) web.goBack() else finish()
            }
        })

        watchNetwork()
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else open(targetUrl(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        open(targetUrl(intent))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        networkCallback?.let { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) }
        if (current === this) current = null
        web.destroy()
        super.onDestroy()
    }

    /** Куда открыть приложение: «Поделиться», ссылка на сайт, нажатие на уведомление. */
    private fun targetUrl(intent: Intent?): String {
        val base = BuildConfig.BASE_URL
        if (intent == null) return "$base/"
        if (intent.action == Intent.ACTION_SEND) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty().take(2000)
            if (text.isNotEmpty()) return "$base/?share=${Uri.encode(text)}"
        }
        intent.getStringExtra(Notify.EXTRA_OPEN_URL)?.let { path ->
            return if (path.startsWith("/")) "$base$path" else "$base/"
        }
        val data = intent.data
        if (intent.action == Intent.ACTION_VIEW && data != null && isOurs(data)) return data.toString()
        return "$base/"
    }

    private fun open(url: String) {
        if (!isOnline()) {
            showOffline()
            pendingUrl = url
            return
        }
        hideOffline()
        web.loadUrl(url)
    }

    private var pendingUrl: String? = null

    private fun isOurs(uri: Uri) = uri.scheme == "https" && uri.host == BuildConfig.SITE_HOST

    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, uri.toString(), Toast.LENGTH_SHORT).show()
        }
    }

    // ---------- Офлайн ----------

    private fun isOnline(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun showOffline() {
        if (offline != null) return
        val view = OfflineView(this, Store.snapshot(this)) { retry() }
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        offline = view
        web.visibility = View.INVISIBLE
    }

    private fun hideOffline() {
        offline?.let { root.removeView(it) }
        offline = null
        web.visibility = View.VISIBLE
    }

    private fun retry() {
        if (!isOnline()) {
            Toast.makeText(this, R.string.offline_title, Toast.LENGTH_SHORT).show()
            return
        }
        val url = pendingUrl ?: web.url ?: "${BuildConfig.BASE_URL}/"
        pendingUrl = null
        hideOffline()
        if (web.url == null || url != web.url) web.loadUrl(url) else web.reload()
    }

    /** Связь вернулась — убрать офлайн-экран и загрузить дела. */
    private fun watchNetwork() {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread { if (offline != null) retry() }
            }
        }
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(callback)
        networkCallback = callback
    }

    // ---------- Мост с веб-частью ----------

    /** Вызвать window.dispatcherNative.<name>(value) в веб-части. */
    fun callWeb(name: String, value: String?) {
        runOnUiThread {
            val arg = if (value == null) "null" else JSONObject.quote(value)
            web.evaluateJavascript("window.dispatcherNative && window.dispatcherNative.$name($arg)", null)
        }
    }

    fun onPushToken(token: String) = callWeb("onPushToken", token)

    fun notificationsState(): String = when {
        Notify.canNotify(this) -> if (Store.pushToken(this).isNullOrEmpty()) "unavailable" else "on"
        else -> "ask"
    }

    fun requestNotifications() = runOnUiThread {
        when {
            Notify.canNotify(this) -> callWeb("onNotifications", notificationsState())
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED -> askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            else -> {
                // Уведомления выключены в настройках телефона — открыть их
                startActivity(
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, packageName),
                )
            }
        }
    }

    fun startVoice() = runOnUiThread {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.voice_prompt))
        try {
            recognizeSpeech.launch(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.voice_unavailable, Toast.LENGTH_LONG).show()
            callWeb("onVoice", null)
        }
    }

    // ---------- WebView ----------

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (isOurs(uri)) return false
            // Почта, телефон, другие сайты — в своих приложениях, не внутри нашего окна
            openOutside(uri)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            trustedPage = url != null && isOurs(Uri.parse(url))
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                pendingUrl = request.url.toString()
                showOffline()
            }
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = filePathCallback
            return try {
                pickFiles.launch(fileChooserParams.createIntent())
                true
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                false
            }
        }

        /** Микрофон для голосового отзыва — только по нажатию на сайте и с разрешения человека. */
        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                val wantsMic = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
                if (!wantsMic || !isOurs(request.origin)) {
                    request.deny()
                    return@runOnUiThread
                }
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) ==
                    PackageManager.PERMISSION_GRANTED
                ) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                    pendingMic?.deny()
                    pendingMic = request
                    askMic.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
        }
    }

    companion object {
        /** Открытый экран — чтобы push-сервис мог передать новый токен веб-части. */
        @Volatile
        var current: MainActivity? = null
            private set
    }
}
