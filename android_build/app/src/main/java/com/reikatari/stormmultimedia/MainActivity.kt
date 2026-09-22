package com.reikatari.stormmultimedia

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.http.SslError
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import java.io.ByteArrayInputStream
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var customViewContainer: FrameLayout
    private lateinit var rootLayout: FrameLayout
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private val primaryUrl = "https://stormmultimedia.ru/"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Поддержка темного системного бара под палитру STORM SOFT
        window.statusBarColor = Color.parseColor("#0a0d14")
        window.navigationBarColor = Color.parseColor("#0a0d14")

        // Скрытие всех системных шторок (верхние, нижние, боковые) и использование 100% площади дисплея
        WindowCompat.setDecorFitsSystemWindows(window, false)

        rootLayout = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0a0d14"))
        }

        // Полноэкранный режим от края до края без урезания контента
        rootLayout.setPadding(0, 0, 0, 0)
        hideSystemUI()

        customViewContainer = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            visibility = View.GONE
            setBackgroundColor(Color.BLACK)
        }

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0a0d14"))
        }

        rootLayout.addView(webView)
        rootLayout.addView(customViewContainer)
        setContentView(rootLayout)

        setupWebSettings()
        setupClients()
        setupBackNavigation()

        loadAppContent()
    }

    private fun loadAppContent() {
        try {
            val html = assets.open("index.html").bufferedReader().use { it.readText() }
            webView.loadDataWithBaseURL(
                "https://stormmultimedia.ru/",
                html,
                "text/html",
                "UTF-8",
                "https://stormmultimedia.ru/"
            )
        } catch (_: Exception) {
            webView.loadUrl(primaryUrl)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebSettings() {
        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.allowFileAccessFromFileURLs = true
        settings.allowUniversalAccessFromFileURLs = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // Корректный мобильный адаптивный viewport и запрет искажения текста системным зумом Android
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.textZoom = 100
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.setSupportZoom(false)
        settings.userAgentString = "${settings.userAgentString} StormMultimediaApp/1.0.24"

        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.requestFocusFromTouch()

        webView.addJavascriptInterface(StormAndroidBridge(), "StormAndroidBridge")
    }

    private fun createAssetResponse(mimeType: String, assetPath: String): WebResourceResponse? {
        return try {
            val stream = assets.open(assetPath)
            val headers = mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Access-Control-Allow-Methods" to "GET, POST, OPTIONS, HEAD",
                "Access-Control-Allow-Headers" to "*",
                "Cache-Control" to "no-cache, no-store, must-revalidate"
            )
            WebResourceResponse(mimeType, "UTF-8", 200, "OK", headers, stream)
        } catch (_: Exception) {
            null
        }
    }

    private fun setupClients() {
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                val urlLower = url.lowercase()
                if (url.endsWith(".apk") || url.contains("/releases/download/")) {
                    try {
                        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, request.url)
                        startActivity(intent)
                        return true
                    } catch (_: Exception) {}
                }
                // Блокируем внешние редиректы на сайт RuTube и рекламу казино
                if (urlLower.contains("rutube.ru/video/") ||
                    urlLower.contains("rutube.ru/channel/") ||
                    urlLower.contains("rutube.ru/?") ||
                    urlLower == "https://rutube.ru/" ||
                    urlLower == "https://rutube.ru" ||
                    urlLower.contains("1xbet") ||
                    urlLower.contains("melbet") ||
                    urlLower.contains("winline") ||
                    urlLower.contains("fonbet") ||
                    urlLower.contains("vavada")) {
                    return true
                }
                return false
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    loadAppContent()
                }
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url ?: return super.shouldInterceptRequest(view, request)
                val host = url.host?.lowercase()

                // Мгновенный запуск: отдаем локальные HTML, CSS, JS и медиа-ассеты без сетевых задержек и таймаутов под VPN
                if (host == "stormmultimedia.ru" || host == "www.stormmultimedia.ru") {
                    val path = url.path ?: "/"
                    if (path == "/" || path == "/index.html") {
                        return createAssetResponse("text/html", "index.html") ?: super.shouldInterceptRequest(view, request)
                    }

                    if (path.startsWith("/styles/") || path.startsWith("/js/") || path.startsWith("/assets/") || path == "/manifest.json") {
                        val assetPath = path.removePrefix("/")
                        val cleanPath = assetPath.substringBefore("?")
                        val mimeType = when {
                            cleanPath.endsWith(".css") -> "text/css"
                            cleanPath.endsWith(".js") -> "application/javascript"
                            cleanPath.endsWith(".svg") -> "image/svg+xml"
                            cleanPath.endsWith(".png") -> "image/png"
                            cleanPath.endsWith(".jpg") || cleanPath.endsWith(".jpeg") -> "image/jpeg"
                            cleanPath.endsWith(".webp") -> "image/webp"
                            cleanPath.endsWith(".ico") -> "image/x-icon"
                            cleanPath.endsWith(".woff2") -> "font/woff2"
                            cleanPath.endsWith(".woff") -> "font/woff"
                            cleanPath.endsWith(".ttf") -> "font/ttf"
                            cleanPath.endsWith(".json") -> "application/json"
                            else -> "application/octet-stream"
                        }
                        return createAssetResponse(mimeType, cleanPath) ?: super.shouldInterceptRequest(view, request)
                    }
                }

                // STORM AD BLOCKER: аппаратная фильтрация и блокировка рекламы, VAST-роликов и трекеров казино
                if (host != null) {
                    val urlStr = url.toString().lowercase()

                    // Перехват рекламных запросов RuTube и подмена на пустой VAST документ для мгновенного старта
                    val isRutubeAd = host.startsWith("a.rutube.ru") ||
                                     host.startsWith("yast.rutube.ru") ||
                                     host.startsWith("ssp.rutube.ru") ||
                                     host.startsWith("goya.rutube.ru") ||
                                     (host.contains("rutube.ru") && (
                                         urlStr.contains("/api/v1/ad") ||
                                         urlStr.contains("/gowast/") ||
                                         urlStr.contains("/adonline/") ||
                                         urlStr.contains("/banner/") ||
                                         urlStr.contains("/ssp/")
                                     ))

                    if (isRutubeAd) {
                        val emptyVast = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><VAST version=\"2.0\"></VAST>"
                        val headers = mapOf(
                            "Access-Control-Allow-Origin" to "*",
                            "Access-Control-Allow-Methods" to "GET, POST, OPTIONS, HEAD",
                            "Access-Control-Allow-Headers" to "*",
                            "Content-Type" to "application/xml; charset=UTF-8"
                        )
                        return WebResourceResponse(
                            "application/xml",
                            "UTF-8",
                            200,
                            "OK",
                            headers,
                            ByteArrayInputStream(emptyVast.toByteArray())
                        )
                    }

                    val adHosts = arrayOf(
                        "adsystem", "adriver", "doubleclick", "yandex.ru/ads", "an.yandex",
                        "adservice", "googlesyndication", "adnxs", "adfox", "adkernel",
                        "redclick", "marketgid", "begun", "target.my.com", "moevideo",
                        "traff", "clicker", "bidding", "banner", "1xbet", "melbet",
                        "betboom", "winline", "fonbet", "parimatch", "vulkan", "pin-up",
                        "vavada", "mostbet", "propellerads", "clickadu", "popcash",
                        "adsterra", "exoclick", "trafficjunky", "hilltopads", "evadav"
                    )
                    val isAd = adHosts.any { host.contains(it) } ||
                               urlStr.contains("/vast/") ||
                               urlStr.contains("/vpaid/") ||
                               urlStr.contains("preroll") ||
                               urlStr.contains("midroll")

                    val isWhitelisted = host.contains("stormmultimedia.ru") ||
                                       host.contains("tmdb.org") ||
                                       host.contains("themoviedb.org") ||
                                       host.contains("anilibria") ||
                                       (host == "rutube.ru" || host == "www.rutube.ru" || host == "bl.rutube.ru") ||
                                       host.contains("vkvideo.ru") ||
                                       host.contains("vk.com")

                    if (isAd && !isWhitelisted) {
                        return WebResourceResponse(
                            "text/plain",
                            "UTF-8",
                            200,
                            "OK",
                            emptyMap(),
                            ByteArrayInputStream(ByteArray(0))
                        )
                    }
                }

                return super.shouldInterceptRequest(view, request)
            }

            @SuppressLint("WebViewClientOnReceivedSslError")
            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                handler?.proceed()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (customView != null) {
                    onHideCustomView()
                    return
                }

                customView = view
                customViewCallback = callback

                webView.visibility = View.GONE
                customViewContainer.visibility = View.VISIBLE
                customViewContainer.addView(view)

                // Полноэкранный режим: разворачиваем на весь дисплей без системных рамок
                WindowCompat.setDecorFitsSystemWindows(window, false)
                rootLayout.setPadding(0, 0, 0, 0)
                hideSystemUI()

                // Используем сенсорную ориентацию без принудительного жесткого переворота экрана
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR
            }

            override fun onHideCustomView() {
                if (customView == null) return

                customViewContainer.removeView(customView)
                customView = null
                customViewCallback?.onCustomViewHidden()
                customViewCallback = null

                customViewContainer.visibility = View.GONE
                webView.visibility = View.VISIBLE

                // Возврат в полноэкранный иммерсивный режим без системных шторок
                WindowCompat.setDecorFitsSystemWindows(window, false)
                rootLayout.setPadding(0, 0, 0, 0)
                hideSystemUI()

                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR
            }
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customView != null) {
                    webView.webChromeClient?.onHideCustomView()
                    return
                }

                // Передаем нажатие системной кнопки "Назад" в JavaScript SPA
                webView.evaluateJavascript("(function(){ return window.handleStormBackNavigation ? window.handleStormBackNavigation() : false; })();") { result ->
                    val handled = result?.equals("true", ignoreCase = true) == true
                    if (!handled) {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            finish()
                        }
                    }
                }
            }
        })
    }

    inner class StormAndroidBridge {
        @android.webkit.JavascriptInterface
        fun exitApp() {
            runOnUiThread {
                finish()
            }
        }
    }

    private fun hideSystemUI() {
        WindowCompat.getInsetsController(window, window.decorView).let { controller ->
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemUI()
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemUI()
        webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
