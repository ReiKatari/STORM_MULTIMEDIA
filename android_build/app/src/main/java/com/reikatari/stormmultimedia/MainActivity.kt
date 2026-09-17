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
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
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
    private val fallbackUrl = "file:///android_asset/index.html"
    private var isOfflineFallbackLoaded = false

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

        webView.loadUrl(primaryUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebSettings() {
        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // Отключаем десктопный overview режим, вызывающий неконтролируемое масштабирование и блокировку зума
        settings.useWideViewPort = false
        settings.loadWithOverviewMode = false
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.setSupportZoom(false)
        settings.userAgentString = "${settings.userAgentString} StormMultimediaApp/1.0.7"

        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.requestFocusFromTouch()

        webView.setDownloadListener { url, _, _, _, _ ->
            try {
                val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                startActivity(intent)
            } catch (_: Exception) {}
        }
    }

    private fun setupClients() {
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.endsWith(".apk") || url.contains("/releases/download/")) {
                    try {
                        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, request.url)
                        startActivity(intent)
                        return true
                    } catch (_: Exception) {}
                }
                return false
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true && !isOfflineFallbackLoaded) {
                    isOfflineFallbackLoaded = true
                    webView.loadUrl(fallbackUrl)
                }
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
                } else if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
            }
        })
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
