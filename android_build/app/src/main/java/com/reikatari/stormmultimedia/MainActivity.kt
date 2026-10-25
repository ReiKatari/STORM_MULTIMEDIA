package com.reikatari.stormmultimedia

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
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
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var customViewContainer: FrameLayout
    private lateinit var rootLayout: FrameLayout
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private val primaryUrl = "https://stormmultimedia.ru/"
    private val liftPrimaryIp = "89.42.231.205"

    private val permissiveSslSocketFactory by lazy {
        try {
            val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
                override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
            })
            val sslContext = SSLContext.getInstance("TLS")
            sslContext.init(null, trustAllCerts, SecureRandom())
            sslContext.socketFactory
        } catch (_: Throwable) {
            null
        }
    }

    private val permissiveHostnameVerifier = HostnameVerifier { _, _ -> true }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.parseColor("#0a0d14")
        window.navigationBarColor = Color.parseColor("#0a0d14")
        WindowCompat.setDecorFitsSystemWindows(window, false)

        rootLayout = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0a0d14"))
            setPadding(0, 0, 0, 0)
        }
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
        ensureStormRootStorageAndPermissions()

        loadAppContent()
    }

    private fun ensureStormRootStorageAndPermissions() {
        try {
            // Инициализируем директории приложения без принудительного выброса пользователя в системные настройки при старте
            initStormMultimediaRootDirectory()

            if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) {
                val writeGranted = androidx.core.content.ContextCompat.checkSelfPermission(
                    this,
                    android.Manifest.permission.WRITE_EXTERNAL_STORAGE
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!writeGranted) {
                    androidx.core.app.ActivityCompat.requestPermissions(
                        this,
                        arrayOf(
                            android.Manifest.permission.READ_EXTERNAL_STORAGE,
                            android.Manifest.permission.WRITE_EXTERNAL_STORAGE
                        ),
                        1001
                    )
                }
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                val notifGranted = androidx.core.content.ContextCompat.checkSelfPermission(
                    this,
                    android.Manifest.permission.POST_NOTIFICATIONS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!notifGranted) {
                    androidx.core.app.ActivityCompat.requestPermissions(
                        this,
                        arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                        1002
                    )
                }
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                display?.supportedModes?.maxByOrNull { it.refreshRate }?.let { maxMode ->
                    window.attributes = window.attributes.apply {
                        preferredDisplayModeId = maxMode.modeId
                    }
                }
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                val gameManager = getSystemService(android.app.GameManager::class.java)
                gameManager?.setGameState(
                    android.app.GameState(false, android.app.GameState.MODE_GAMEPLAY_UNINTERRUPTIBLE)
                )
            }
        } catch (_: Throwable) {}
    }

    private fun initStormMultimediaRootDirectory() {
        try {
            getExternalFilesDir(null)?.let { appExt ->
                listOf("settings", "cache", "downloads", "offline", "subtitles", "logs", "updates").forEach { sub ->
                    java.io.File(appExt, sub).mkdirs()
                }
            }
            val rootDir = java.io.File(android.os.Environment.getExternalStorageDirectory(), "STORM MULTIMEDIA")
            if (!rootDir.exists()) rootDir.mkdirs()
            listOf("settings", "cache", "downloads", "offline", "subtitles", "logs", "updates").forEach { sub ->
                java.io.File(rootDir, sub).mkdirs()
            }
        } catch (_: Throwable) {}
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

        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.textZoom = 100
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.setSupportZoom(false)
        val pkgVersion = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.51"
        } catch (_: Throwable) {
            "1.0.51"
        }
        settings.userAgentString = "${settings.userAgentString} StormMultimediaApp/$pkgVersion"
        try {
            val prefs = getSharedPreferences("storm_webview_prefs", MODE_PRIVATE)
            if (prefs.getString("last_version", "") != pkgVersion) {
                webView.clearCache(true)
                prefs.edit().putString("last_version", pkgVersion).apply()
            }
        } catch (_: Throwable) {}

        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.requestFocusFromTouch()

        val bridge = StormAndroidBridge()
        webView.addJavascriptInterface(bridge, "StormAndroidBridge")
        webView.addJavascriptInterface(bridge, "StormNativeApp")
    }

    private fun corsHeaders(contentType: String = "application/json; charset=UTF-8", cacheControl: String = "no-cache"): Map<String, String> {
        return mapOf(
            "Access-Control-Allow-Origin" to "*",
            "Access-Control-Allow-Methods" to "GET, POST, PUT, DELETE, OPTIONS, HEAD",
            "Access-Control-Allow-Headers" to "*",
            "Cache-Control" to cacheControl,
            "Content-Type" to contentType
        )
    }

    private fun createJsonResponse(jsonStr: String, statusCode: Int = 200): WebResourceResponse {
        return WebResourceResponse(
            "application/json",
            "UTF-8",
            statusCode,
            "OK",
            corsHeaders("application/json; charset=UTF-8"),
            ByteArrayInputStream(jsonStr.toByteArray(Charsets.UTF_8))
        )
    }

    private fun createHtmlResponse(htmlStr: String, statusCode: Int = 200): WebResourceResponse {
        return WebResourceResponse(
            "text/html",
            "UTF-8",
            statusCode,
            "OK",
            corsHeaders("text/html; charset=UTF-8"),
            ByteArrayInputStream(htmlStr.toByteArray(Charsets.UTF_8))
        )
    }

    private fun createAssetResponse(mimeType: String, assetPath: String): WebResourceResponse? {
        return try {
            val stream = assets.open(assetPath)
            WebResourceResponse(mimeType, "UTF-8", 200, "OK", corsHeaders(mimeType), stream)
        } catch (_: Exception) {
            null
        }
    }

    private fun fetchLiftRaw(urlStr: String, hostHeader: String, timeoutMs: Int = 5500): Pair<Int, ByteArray>? {
        return try {
            val parsed = URL(urlStr)
            val targetUrl = if (parsed.host.endsWith("liftw.ws") || parsed.host.endsWith("lateremb.ws")) {
                URL("${parsed.protocol}://$liftPrimaryIp${if (parsed.port != -1) ":${parsed.port}" else ""}${parsed.file}")
            } else {
                parsed
            }
            val conn = (targetUrl.openConnection() as HttpURLConnection).apply {
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                instanceFollowRedirects = true
                requestMethod = "GET"
                setRequestProperty("Host", hostHeader)
                setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")
                setRequestProperty("Accept", "*/*")
                setRequestProperty("Accept-Language", "ru-RU,ru;q=0.9,en-US;q=0.8")
                setRequestProperty("Origin", "https://liftw.ws")
                setRequestProperty("Referer", "https://liftw.ws/")
                if (this is HttpsURLConnection) {
                    permissiveSslSocketFactory?.let { sslSocketFactory = it }
                    hostnameVerifier = permissiveHostnameVerifier
                }
            }
            val code = conn.responseCode
            val bytes = if (code in 200..299) {
                conn.inputStream.use { it.readBytes() }
            } else {
                ByteArray(0)
            }
            conn.disconnect()
            Pair(code, bytes)
        } catch (_: Throwable) {
            null
        }
    }

    private fun fetchHttpBytes(urlStr: String, timeoutMs: Int = 4500, referer: String? = null): Pair<String, ByteArray>? {
        return try {
            val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                instanceFollowRedirects = true
                requestMethod = "GET"
                setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")
                if (!referer.isNullOrBlank()) {
                    setRequestProperty("Referer", referer)
                }
            }
            val code = conn.responseCode
            if (code in 200..299) {
                val ct = conn.contentType ?: "application/octet-stream"
                val bytes = conn.inputStream.use { it.readBytes() }
                conn.disconnect()
                if (bytes.size > 64) Pair(ct, bytes) else null
            } else {
                conn.disconnect()
                null
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun generateSvgPosterResponse(title: String): WebResourceResponse {
        val cleanTitle = title.ifBlank { "STORM MULTIMEDIA" }
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .take(48)
        val svg = """
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900">
              <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#0b1120"/>
                  <stop offset="50%" stop-color="#131c33"/>
                  <stop offset="100%" stop-color="#070a12"/>
                </linearGradient>
              </defs>
              <rect width="600" height="900" fill="url(#bg)"/>
              <circle cx="300" cy="280" r="170" fill="#00d2ff" opacity="0.07"/>
              <rect x="28" y="28" width="544" height="844" rx="24" fill="none" stroke="#00d2ff" stroke-opacity="0.28" stroke-width="2"/>
              <text x="300" y="115" text-anchor="middle" fill="#00d2ff" font-family="sans-serif" font-size="16" font-weight="800" letter-spacing="2">4K ULTRA HD</text>
              <circle cx="300" cy="300" r="60" fill="#00d2ff" opacity="0.14" stroke="#00d2ff" stroke-opacity="0.45" stroke-width="2"/>
              <polygon points="284,272 284,328 332,300" fill="#00d2ff"/>
              <text x="300" y="520" text-anchor="middle" fill="#f8fafc" font-family="sans-serif" font-size="30" font-weight="800">$cleanTitle</text>
              <text x="300" y="815" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="15" font-weight="700" letter-spacing="3">STORM MULTIMEDIA</text>
            </svg>
        """.trimIndent()
        return WebResourceResponse(
            "image/svg+xml",
            "UTF-8",
            200,
            "OK",
            corsHeaders("image/svg+xml; charset=UTF-8", "public, max-age=3600"),
            ByteArrayInputStream(svg.toByteArray(Charsets.UTF_8))
        )
    }

    private fun handleNativeImageProxy(uri: Uri): WebResourceResponse {
        var rawUrl = uri.getQueryParameter("url") ?: ""
        val title = uri.getQueryParameter("title") ?: ""

        while (rawUrl.contains("/api/media/image-proxy")) {
            val nested = try {
                Uri.parse(rawUrl).getQueryParameter("url")
            } catch (_: Throwable) {
                null
            }
            if (!nested.isNullOrBlank()) {
                rawUrl = try { URLDecoder.decode(nested, "UTF-8") } catch (_: Throwable) { nested }
            } else {
                break
            }
        }

        if (rawUrl.startsWith("//")) rawUrl = "https:$rawUrl"

        if (rawUrl.isNotBlank()) {
            if (rawUrl.contains("img.liftw.ws") || rawUrl.contains("lateremb.ws")) {
                val liftImg = fetchLiftRaw(rawUrl, "img.liftw.ws", 3500)
                if (liftImg != null && liftImg.first in 200..299 && liftImg.second.size > 100) {
                    return WebResourceResponse(
                        "image/jpeg",
                        null,
                        200,
                        "OK",
                        corsHeaders("image/jpeg", "public, max-age=86400"),
                        ByteArrayInputStream(liftImg.second)
                    )
                }
            } else if (rawUrl.startsWith("http")) {
                val wsrvUrl = "https://wsrv.nl/?url=${URLEncoder.encode(rawUrl, "UTF-8")}&w=500&q=85&output=webp"
                val wsrvRes = fetchHttpBytes(wsrvUrl, 3800)
                if (wsrvRes != null) {
                    val mime = wsrvRes.first.substringBefore(";").ifBlank { "image/webp" }
                    return WebResourceResponse(
                        mime,
                        null,
                        200,
                        "OK",
                        corsHeaders(mime, "public, max-age=86400"),
                        ByteArrayInputStream(wsrvRes.second)
                    )
                }
                val directRes = fetchHttpBytes(rawUrl, 3500)
                if (directRes != null) {
                    val mime = directRes.first.substringBefore(";").ifBlank { "image/jpeg" }
                    return WebResourceResponse(
                        mime,
                        null,
                        200,
                        "OK",
                        corsHeaders(mime, "public, max-age=86400"),
                        ByteArrayInputStream(directRes.second)
                    )
                }
            }
        }

        // Если прямой URL устарел (404 на img.liftw.ws) или не передан — ищем свежий постер в базе Lift по названию
        if (title.isNotBlank()) {
            try {
                val cleanQuery = title.replace(Regex("\\(\\d{4}\\)"), "").trim()
                val searchResp = fetchLiftRaw(
                    "https://api.liftw.ws/search?q=${URLEncoder.encode(cleanQuery, "UTF-8")}",
                    "api.liftw.ws",
                    3500
                )
                if (searchResp != null && searchResp.first in 200..299 && searchResp.second.isNotEmpty()) {
                    val arr = JSONArray(String(searchResp.second, Charsets.UTF_8))
                    if (arr.length() > 0) {
                        val first = arr.getJSONObject(0)
                        val freshPoster = first.optString("poster").ifBlank {
                            first.optJSONObject("info")?.optString("poster") ?: ""
                        }
                        if (freshPoster.isNotBlank()) {
                            val freshImg = fetchLiftRaw(freshPoster, "img.liftw.ws", 3500)
                            if (freshImg != null && freshImg.first in 200..299 && freshImg.second.size > 100) {
                                return WebResourceResponse(
                                    "image/jpeg",
                                    null,
                                    200,
                                    "OK",
                                    corsHeaders("image/jpeg", "public, max-age=86400"),
                                    ByteArrayInputStream(freshImg.second)
                                )
                            }
                        }
                    }
                }
            } catch (_: Throwable) {}
        }

        return generateSvgPosterResponse(title)
    }

    private fun resolveLiftIdByTitle(rawLiftId: String, title: String, origTitle: String, year: String): String {
        val cleanId = rawLiftId.replace(Regex("^lift_"), "").trim()
        if (cleanId.matches(Regex("^\\d+$"))) return cleanId

        val norm = { s: String ->
            s.lowercase()
                .replace("ё", "е")
                .replace(Regex("[^a-zа-я0-9]+"), " ")
                .replace(Regex("\\s+"), " ")
                .trim()
        }
        val targetRu = norm(title.replace(Regex("\\(\\d{4}\\)"), ""))
        val targetOrig = norm(origTitle.replace(Regex("\\(\\d{4}\\)"), ""))
        val reqYear = year.toIntOrNull() ?: 0

        val queries = listOf(title, origTitle)
            .map { it.replace(Regex("\\(\\d{4}\\)"), "").trim() }
            .filter { it.length >= 2 }
            .distinct()

        for (q in queries) {
            try {
                val resp = fetchLiftRaw(
                    "https://api.liftw.ws/search?q=${URLEncoder.encode(q, "UTF-8")}",
                    "api.liftw.ws",
                    4500
                )
                if (resp != null && resp.first in 200..299 && resp.second.isNotEmpty()) {
                    val arr = JSONArray(String(resp.second, Charsets.UTF_8))
                    for (i in 0 until arr.length()) {
                        val obj = arr.getJSONObject(i)
                        val info = obj.optJSONObject("info") ?: JSONObject()
                        val name = norm(obj.optString("name", info.optString("name", "")))
                        val orig = norm(obj.optString("origin_name", info.optString("name_eng", "")))
                        val itemYear = obj.optString("year", info.optString("year", "")).toIntOrNull() ?: 0
                        val yearOk = reqYear == 0 || itemYear == 0 || kotlin.math.abs(reqYear - itemYear) <= 2
                        val titleOk = (targetRu.isNotBlank() && name == targetRu) ||
                            (targetOrig.isNotBlank() && orig == targetOrig)
                        if (titleOk && yearOk) {
                            val foundId = obj.optInt("id", info.optInt("id", 0))
                            if (foundId > 0) return foundId.toString()
                        }
                    }
                }
            } catch (_: Throwable) {}
        }
        return ""
    }

    private fun resolveRuTubeIdByTitle(title: String, origTitle: String, year: String, season: String, episode: String, allowTrailer: Boolean = false): Pair<String, Boolean> {
        val cleanTitle = title.replace(Regex("\\(\\d{4}\\)"), "").trim()
        val cleanOrig = origTitle.replace(Regex("\\(\\d{4}\\)"), "").trim()
        if (cleanTitle.isBlank() && cleanOrig.isBlank()) return Pair("", false)

        val norm = { s: String ->
            s.lowercase()
                .replace("ё", "е")
                .replace(Regex("[^a-zа-я0-9]+"), " ")
                .replace(Regex("\\s+"), " ")
                .trim()
        }
        val targetWords = norm(cleanTitle).split(" ").filter { it.length >= 3 }
        val origWords = norm(cleanOrig).split(" ").filter { it.length >= 3 }
        val blockedCats = Regex("(?:авто[- ]?мото|видеоигр|спорт|охота|рыбалк|путешеств|строительств|ремонт|сад|техник|кулинар|животн|лайфстайл|хобби|красот|новости|наука|обучени|бизнес|недвижимост|эзотерик|интервью)", RegexOption.IGNORE_CASE)
        val blockedTitleRe = Regex("(?:\\b\\d{1,2}\\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\\b|эндуро|enduro|мото|питбайк|покатушк|оффроуд|гонк|рыбалк|страйкбол|таро|tarot|влог|vlog|прохождение|стрим|обзор|разбор)", RegexOption.IGNORE_CASE)
        val trailerRe = Regex("(?:трейлер|тизер|trailer|teaser|промо|фрагмент|отрывок)", RegexOption.IGNORE_CASE)

        val queries = mutableListOf<String>()
        if (allowTrailer) {
            if (cleanOrig.isNotBlank()) queries.add("$cleanOrig $year".trim())
            if (cleanTitle.isNotBlank()) queries.add("$cleanTitle $year трейлер".trim())
        } else {
            val suffix = if (season.isNotBlank() && episode.isNotBlank()) " $season сезон $episode серия" else if (year.isNotBlank()) " фильм $year" else " фильм"
            if (cleanTitle.isNotBlank()) queries.add("$cleanTitle$suffix".trim())
            if (cleanTitle.isNotBlank() && cleanOrig.isNotBlank()) queries.add("$cleanTitle $cleanOrig $year".trim())
        }

        for (query in queries) {
            try {
                val apiUrl = "https://rutube.ru/api/search/video/?query=${URLEncoder.encode(query, "UTF-8")}&format=json"
                val resp = fetchHttpBytes(apiUrl, 4500, "https://rutube.ru/") ?: continue
                val json = JSONObject(String(resp.second, Charsets.UTF_8))
                val results = json.optJSONArray("results") ?: continue
                for (i in 0 until results.length()) {
                    val it = results.getJSONObject(i)
                    val id = it.optString("id", "")
                    if (id.length != 32) continue
                    val dur = it.optInt("duration", 0)
                    val candTitle = it.optString("title", "")
                    val catName = it.optJSONObject("category")?.optString("name", "") ?: ""
                    if (catName.isNotBlank() && blockedCats.containsMatchIn(catName)) continue
                    if (blockedTitleRe.containsMatchIn(candTitle)) continue

                    val candNorm = norm(candTitle)
                    val ruMatch = targetWords.isNotEmpty() && targetWords.all { candNorm.contains(it) }
                    val origMatch = origWords.isNotEmpty() && origWords.all { candNorm.contains(it) }
                    if (!ruMatch && !origMatch) continue

                    if (!allowTrailer) {
                        if (trailerRe.containsMatchIn(candTitle)) continue
                        val minDur = if (season.isNotBlank()) 900 else 3600
                        if (dur < minDur || dur > 14400) continue
                        val reqY = year.toIntOrNull() ?: 0
                        if (reqY >= 2025 && !catName.contains("Фильм", true) && !catName.contains("Мультфильм", true) && !catName.contains("Сериал", true) && !catName.contains("Аниме", true)) {
                            continue
                        }
                        return Pair(id, false)
                    } else {
                        if (dur in 35..360) {
                            return Pair(id, true)
                        }
                    }
                }
            } catch (_: Throwable) {}
        }
        return Pair("", false)
    }

    private fun buildPremiereFallbackHtml(title: String, origTitle: String, year: String, trailerRuId: String): WebResourceResponse {
        val safeTitle = title.ifBlank { origTitle.ifBlank { "Премьера" } }
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
        val safeSub = listOf(origTitle.takeIf { it.isNotBlank() && !it.equals(title, true) }, year.takeIf { it.isNotBlank() })
            .filterNotNull().joinToString(" • ")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        val trailerBtn = if (trailerRuId.isNotBlank()) {
            """<button class="btn primary" onclick="playTrailer()">▶ Смотреть официальный трейлер</button>"""
        } else ""
        val html = """
            <!DOCTYPE html>
            <html lang="ru">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
              <style>
                *{box-sizing:border-box}
                html,body{margin:0;padding:0;width:100%;height:100%;background:radial-gradient(circle at 50% 20%,#162038 0%,#080b14 70%);color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden}
                .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center}
                .badge{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;background:rgba(0,210,255,0.14);border:1px solid rgba(0,210,255,0.38);color:#38bdf8;font-size:12px;font-weight:700;letter-spacing:.04em;margin-bottom:14px}
                h1{margin:0 0 6px;font-size:clamp(20px,3.2vw,28px);font-weight:800}
                .sub{color:#94a3b8;font-size:14px;margin-bottom:14px}
                .desc{max-width:540px;color:#cbd5e1;font-size:14px;line-height:1.55;margin:0 0 22px}
                .actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
                .btn{padding:11px 18px;border-radius:10px;border:1px solid rgba(148,163,184,0.28);background:rgba(30,41,59,0.75);color:#f8fafc;font-size:13.5px;font-weight:700;cursor:pointer}
                .btn.primary{background:linear-gradient(135deg,#00d2ff,#3b82f6);color:#04101c;border-color:transparent;box-shadow:0 6px 20px rgba(0,210,255,0.32)}
                #trailer-box{display:none;position:fixed;inset:0;background:#000}
                #trailer-box iframe{width:100%;height:100%;border:0}
                .tr-bar{position:fixed;top:12px;left:12px;z-index:10;display:flex;gap:8px;align-items:center}
                .tr-pill{padding:6px 12px;border-radius:8px;background:rgba(8,11,20,0.82);border:1px solid rgba(0,210,255,0.45);color:#38bdf8;font-size:12px;font-weight:700}
              </style>
            </head>
            <body>
              <div class="wrap" id="info-wrap">
                <div class="badge">🎬 КИНОТЕАТРАЛЬНАЯ ПРЕМЬЕРА • ОЖИДАЕТСЯ ЦИФРОВОЙ РЕЛИЗ</div>
                <h1>$safeTitle</h1>
                ${if (safeSub.isNotBlank()) "<div class=\"sub\">$safeSub</div>" else ""}
                <p class="desc">Полная цифровая версия релиза в 4K / Full HD ещё не вышла в онлайн-кинотеатрах. Как только цифровой релиз состоится, фильм автоматически станет доступен здесь без рекламы.</p>
                <div class="actions">
                  $trailerBtn
                  <button class="btn" onclick="window.parent.postMessage({type:'STORM_BOOKMARK_PLANNED'},'*');this.textContent='✅ В списке «В планах»'">📌 Добавить в «В планах»</button>
                </div>
              </div>
              <div id="trailer-box">
                <div class="tr-bar">
                  <span class="tr-pill">🎞 ОФИЦИАЛЬНЫЙ ТРЕЙЛЕР</span>
                  <button class="btn" style="padding:6px 12px;font-size:12px" onclick="closeTrailer()">← Назад</button>
                </div>
                <div id="tr-mount" style="width:100%;height:100%"></div>
              </div>
              <script>
                function playTrailer(){
                  document.getElementById('info-wrap').style.display='none';
                  document.getElementById('trailer-box').style.display='block';
                  var m=document.getElementById('tr-mount');
                  m.innerHTML='';
                  var f=document.createElement('iframe');
                  f.setAttribute('allow','autoplay; fullscreen; picture-in-picture; encrypted-media');
                  f.setAttribute('allowfullscreen','true');
                  f.src='https://rutube.ru/play/embed/$trailerRuId?skinColor=00d2ff';
                  m.appendChild(f);
                }
                function closeTrailer(){
                  document.getElementById('tr-mount').innerHTML='';
                  document.getElementById('trailer-box').style.display='none';
                  document.getElementById('info-wrap').style.display='flex';
                }
              </script>
            </body>
            </html>
        """.trimIndent()
        return createHtmlResponse(html)
    }

    private fun buildRuTubeEmbedHtml(ruId: String): WebResourceResponse {
        val html = """
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
              <style>html,body,iframe{margin:0;padding:0;width:100%;height:100%;background:#000;border:0;overflow:hidden;}</style>
            </head>
            <body>
              <iframe src="https://rutube.ru/play/embed/$ruId?skinColor=00d2ff" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>
            </body>
            </html>
        """.trimIndent()
        return createHtmlResponse(html)
    }

    private fun handleNativePlayerEmbed(uri: Uri): WebResourceResponse {
        val path = uri.path ?: ""
        if (path == "/api/player/lift-cdn.js") {
            val cdn = fetchLiftRaw("https://embed.liftw.ws/cdn.js", "embed.liftw.ws", 5500)
            if (cdn != null && cdn.first in 200..299 && cdn.second.isNotEmpty()) {
                return WebResourceResponse(
                    "application/javascript",
                    "UTF-8",
                    200,
                    "OK",
                    corsHeaders("application/javascript; charset=UTF-8", "public, max-age=86400"),
                    ByteArrayInputStream(cdn.second)
                )
            }
        }
        if (path == "/api/player/lift-listen.js") {
            val listen = fetchLiftRaw("https://embed.liftw.ws/js/listen-player.js", "embed.liftw.ws", 5500)
            if (listen != null && listen.first in 200..299 && listen.second.isNotEmpty()) {
                return WebResourceResponse(
                    "application/javascript",
                    "UTF-8",
                    200,
                    "OK",
                    corsHeaders("application/javascript; charset=UTF-8", "public, max-age=86400"),
                    ByteArrayInputStream(listen.second)
                )
            }
        }

        if (path.startsWith("/api/player/rutube-embed/")) {
            val ruId = path.substringAfterLast("/").trim()
            if (ruId.isNotBlank()) {
                return buildRuTubeEmbedHtml(ruId)
            }
        }

        val title = uri.getQueryParameter("title") ?: uri.getQueryParameter("fallback_title") ?: ""
        val origTitle = uri.getQueryParameter("original_title") ?: ""
        val year = uri.getQueryParameter("year") ?: uri.getQueryParameter("fallback_year") ?: ""
        val liftIdParam = uri.getQueryParameter("lift_id") ?: ""
        val season = uri.getQueryParameter("season") ?: "1"
        val episode = uri.getQueryParameter("episode") ?: "1"
        val balancer = (uri.getQueryParameter("balancer") ?: "").lowercase()
        val directUrl = uri.getQueryParameter("url") ?: ""

        // Если это прямой запрос RuTube поиска
        if (path == "/api/player/rutube-search-embed" || balancer == "rutube" || balancer == "bazon") {
            val ruPair = resolveRuTubeIdByTitle(title, origTitle, year, if (season != "1" || episode != "1") season else "", episode, false)
            if (ruPair.first.isNotBlank()) {
                return buildRuTubeEmbedHtml(ruPair.first)
            }
        }

        // Если передан внешний iframe URL (например, vk.com, vidsrc, kodik) в adblock-proxy / kodik-embed
        if (directUrl.startsWith("http") && !directUrl.contains("fanfilm4k")) {
            val html = """
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
                  <style>html,body,iframe{margin:0;padding:0;width:100%;height:100%;background:#000;border:0;overflow:hidden;}</style>
                </head>
                <body>
                  <iframe src="$directUrl" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>
                </body>
                </html>
            """.trimIndent()
            return createHtmlResponse(html)
        }

        // Основной 4K/FHD плеер Lift без рекламы (для lift-embed, kinobox-embed, fanfilm-embed и всех балансеров)
        val matchedLiftId = resolveLiftIdByTitle(liftIdParam, title, origTitle, year)
        if (matchedLiftId.isNotBlank()) {
            val embedResp = fetchLiftRaw(
                "https://embed.liftw.ws/embed/movie/$matchedLiftId?host=liftw.ws",
                "embed.liftw.ws",
                6500
            )
            if (embedResp != null && embedResp.first in 200..299 && embedResp.second.isNotEmpty()) {
                var html = String(embedResp.second, Charsets.UTF_8)
                if (html.contains("makePlayer")) {
                    html = html.replace(
                        Regex("<script\\s+data-name=[\"']ad[\"']>[\\s\\S]*?</script>", RegexOption.IGNORE_CASE),
                        "<script data-name=\"ad\">var middleCount = 0, adTimeouts = {}, adsConfig = undefined;</script>"
                    )
                    html = html.replace(Regex("ads:\\s*adsConfig\\s*,"), "ads: undefined,")
                    html = html.replace(Regex("<script\\s+data-name=[\"']ss[\"']>[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), "")
                    html = html.replace(Regex("<script\\s+data-name=[\"']ping[\"']>[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), "")
                    html = html.replace(Regex("stats:\\s*\\[[^\\]]*\\]\\s*,"), "stats: [],")
                    html = html.replace(Regex("src=[\"']//embed\\.liftw\\.ws/cdn\\.js[\"']", RegexOption.IGNORE_CASE), "src=\"/api/player/lift-cdn.js\"")
                    html = html.replace(Regex("src=[\"']//embed\\.liftw\\.ws/js/listen-player\\.js[\"']", RegexOption.IGNORE_CASE), "src=\"/api/player/lift-listen.js\"")
                    val sNum = season.toIntOrNull() ?: 1
                    val eStr = (episode.toIntOrNull() ?: 1).toString()
                    if (sNum > 1 || eStr != "1") {
                        html = html.replace(
                            Regex("current:\\s*\\{\\s*season:\\s*\\d+\\s*,\\s*episode:\\s*[\"'][^\"']+[\"']\\s*\\}"),
                            "current: { season: $sNum, episode: \"$eStr\" }"
                        )
                    }
                    return createHtmlResponse(html)
                }
            }
        }

        // Гарантированный резерв через проверенный кино-каталог RuTube
        val fallbackRuPair = resolveRuTubeIdByTitle(title, origTitle, year, "", "", false)
        if (fallbackRuPair.first.isNotBlank()) {
            return buildRuTubeEmbedHtml(fallbackRuPair.first)
        }

        // Если цифровая премьера ещё не вышла — ищем официальный трейлер и показываем честный экран премьеры
        val trailerPair = resolveRuTubeIdByTitle(title, origTitle, year, "", "", true)
        return buildPremiereFallbackHtml(title, origTitle, year, trailerPair.first)
    }

    private fun normalizeLiftJsonArrayToStormItems(arr: JSONArray): JSONArray {
        val out = JSONArray()
        for (i in 0 until arr.length()) {
            val raw = arr.optJSONObject(i) ?: continue
            val info = raw.optJSONObject("info") ?: JSONObject()
            val liftId = raw.optString("id").ifBlank { info.optString("id") }
            if (liftId.isBlank()) continue
            val title = raw.optString("name").ifBlank { info.optString("name", "Без названия") }
            val origTitle = raw.optString("origin_name").ifBlank { info.optString("name_eng", "") }
            val year = raw.optString("year").ifBlank { info.optString("year", "2026") }
            val kp = raw.optDouble("kp_rating", info.optDouble("kp_rating", 0.0))
            val imdb = raw.optDouble("imdb_rating", info.optDouble("imdb_rating", 0.0))
            val rating = if (kp > 0) kp else imdb
            val rawQual = raw.optString("quality", "FHD").uppercase()
            val is4k = rawQual.contains("4K") || rawQual.contains("UHD")
            val rawPoster = info.optString("poster_big").ifBlank { info.optString("poster").ifBlank { raw.optString("poster") } }
            val poster = if (rawPoster.isNotBlank()) {
                "/api/media/image-proxy?url=${URLEncoder.encode(rawPoster, "UTF-8")}&title=${URLEncoder.encode(title, "UTF-8")}"
            } else {
                "/api/media/image-proxy?title=${URLEncoder.encode(title, "UTF-8")}"
            }
            val tNum = raw.optInt("type", 1)
            val mediaType = when (tNum) {
                2 -> "cartoons"
                3, 4 -> "series"
                5 -> "cartoon-series"
                6 -> "anime-movies"
                7 -> "anime-series"
                else -> "movies"
            }
            val itemObj = JSONObject().apply {
                put("id", "lift_$liftId")
                put("lift_id", liftId)
                put("source", "lift")
                put("title", title)
                put("original_title", origTitle)
                put("year", year)
                put("poster", poster)
                put("backdrop", poster)
                put("rating", if (rating > 0) Math.round(rating * 10.0) / 10.0 else 7.8)
                put("quality", if (is4k) "4K UHD" else "1080p FHD")
                put("is_4k", is4k)
                put("is4K", is4k)
                put("media_type", mediaType)
                put("is_series", mediaType.contains("series"))
                put("description", info.optString("description", raw.optString("description", "")))
            }
            out.put(itemObj)
        }
        return out
    }

    private fun handleStormApiIntercept(uri: Uri): WebResourceResponse {
        val path = uri.path ?: "/api/"

        if (path == "/api/health" || path == "/api/player/health") {
            return createJsonResponse("""{"status":"ok","native_android":true,"version":"1.0.51"}""")
        }

        if (path == "/api/media/image-proxy") {
            return handleNativeImageProxy(uri)
        }

        if (path.startsWith("/api/player/")) {
            if (path == "/api/player/series-options") {
                return createJsonResponse("""{"seasons":[]}""")
            }
            if (path == "/api/player/check-stream") {
                return createJsonResponse("""{"alive":true}""")
            }
            return handleNativePlayerEmbed(uri)
        }

        if (path.startsWith("/api/auth/")) {
            val prefs = getSharedPreferences("storm_auth_prefs", MODE_PRIVATE)
            if (path == "/api/auth/logout") {
                return createJsonResponse("""{"success":true}""")
            }
            val savedUser = prefs.getString("username", "ReiKatari") ?: "ReiKatari"
            val savedEmail = prefs.getString("email", "ReiKatari@storm.local") ?: "ReiKatari@storm.local"
            val userJson = JSONObject().apply {
                put("id", 1)
                put("username", savedUser)
                put("email", savedEmail)
                put("role", "admin")
                put("avatar", "assets/avatar_default.svg")
            }
            val respJson = JSONObject().apply {
                put("success", true)
                put("token", "native_android_token_1")
                put("user", userJson)
                put("stats", JSONObject().put("bookmarks_count", 0).put("history_count", 0))
            }
            return createJsonResponse(respJson.toString())
        }

        if (path == "/api/media/search") {
            val q = uri.getQueryParameter("q") ?: uri.getQueryParameter("query") ?: ""
            if (q.isNotBlank()) {
                val liftResp = fetchLiftRaw(
                    "https://api.liftw.ws/search?q=${URLEncoder.encode(q, "UTF-8")}",
                    "api.liftw.ws",
                    4500
                )
                if (liftResp != null && liftResp.first in 200..299 && liftResp.second.isNotEmpty()) {
                    return try {
                        val arr = JSONArray(String(liftResp.second, Charsets.UTF_8))
                        val items = normalizeLiftJsonArrayToStormItems(arr)
                        createJsonResponse(JSONObject().put("items", items).put("total_items", items.length()).toString())
                    } catch (_: Throwable) {
                        createJsonResponse("""{"items":[]}""")
                    }
                }
            }
            return createJsonResponse("""{"items":[]}""")
        }

        if (path == "/api/media/catalog") {
            val cat = (uri.getQueryParameter("category") ?: "popular").lowercase()
            val page = (uri.getQueryParameter("page") ?: "1").toIntOrNull() ?: 1
            val offset = (page - 1) * 24
            val liftCat = when (cat) {
                "movies" -> "films"
                "series" -> "series"
                "cartoons" -> "cartoons"
                "cartoon-series" -> "cartoon_series"
                "anime", "anime-series" -> "anime_series"
                "anime-movies" -> "anime_films"
                else -> "all"
            }
            val apiUrl = if (liftCat == "all") {
                "https://api.liftw.ws/list?type=film&last=true&limit=24&offset=$offset"
            } else {
                "https://api.liftw.ws/list/categories?category=$liftCat&sort=views&limit=24&offset=$offset"
            }
            val liftResp = fetchLiftRaw(apiUrl, "api.liftw.ws", 4500)
            if (liftResp != null && liftResp.first in 200..299 && liftResp.second.isNotEmpty()) {
                return try {
                    val rawStr = String(liftResp.second, Charsets.UTF_8).trim()
                    val arr = if (rawStr.startsWith("[")) JSONArray(rawStr) else JSONObject(rawStr).optJSONArray("items") ?: JSONArray()
                    val items = normalizeLiftJsonArrayToStormItems(arr)
                    val out = JSONObject().apply {
                        put("items", items)
                        put("total_pages", 100)
                        put("total_items", 2400)
                    }
                    createJsonResponse(out.toString())
                } catch (_: Throwable) {
                    createJsonResponse("""{"items":[],"total_pages":1,"total_items":0}""")
                }
            }
            return createJsonResponse("""{"items":[],"total_pages":1,"total_items":0}""")
        }

        if (path == "/api/bookmarks" || path == "/api/media/continue-watching" || path == "/api/lists" || path == "/api/achievements") {
            return createJsonResponse("[]")
        }

        return createJsonResponse("""{"success":true,"offline_bridge":true}""")
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

                if (host == "stormmultimedia.ru" || host == "www.stormmultimedia.ru") {
                    val path = url.path ?: "/"
                    if (path == "/" || path == "/index.html") {
                        return createAssetResponse("text/html", "index.html") ?: super.shouldInterceptRequest(view, request)
                    }
                    if (path == "/remote.html") {
                        return createAssetResponse("text/html", "remote.html") ?: super.shouldInterceptRequest(view, request)
                    }

                    if (path.startsWith("/api/")) {
                        return handleStormApiIntercept(url)
                    }

                    if (path.startsWith("/styles/") || path.startsWith("/js/") || path.startsWith("/assets/") || path.startsWith("/vendor/") || path == "/manifest.json") {
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

                // Прозрачный DNS-обход для прямых запросов к *.liftw.ws внутри плеерных iframe на Android
                if (host != null && (host.endsWith("liftw.ws") || host.endsWith("lateremb.ws"))) {
                    val liftResp = fetchLiftRaw(url.toString(), host, 5500)
                    if (liftResp != null && liftResp.first in 200..299 && liftResp.second.isNotEmpty()) {
                        val path = url.path ?: ""
                        val mime = when {
                            path.endsWith(".js") -> "application/javascript"
                            path.endsWith(".css") -> "text/css"
                            host.startsWith("img.") || path.endsWith(".jpg") || path.endsWith(".webp") -> "image/jpeg"
                            else -> "application/json"
                        }
                        return WebResourceResponse(
                            mime,
                            "UTF-8",
                            200,
                            "OK",
                            corsHeaders(mime),
                            ByteArrayInputStream(liftResp.second)
                        )
                    }
                }

                if (host != null) {
                    val urlStr = url.toString().lowercase()
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
                        return WebResourceResponse(
                            "application/xml",
                            "UTF-8",
                            200,
                            "OK",
                            corsHeaders("application/xml; charset=UTF-8"),
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
                                       host.contains("wsrv.nl") ||
                                       host.contains("weserv.nl") ||
                                       host.contains("liftw.ws") ||
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

                WindowCompat.setDecorFitsSystemWindows(window, false)
                rootLayout.setPadding(0, 0, 0, 0)
                hideSystemUI()

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
        fun getAppVersion(): String {
            return try {
                packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.51"
            } catch (_: Throwable) {
                "1.0.51"
            }
        }

        @android.webkit.JavascriptInterface
        fun exitApp() {
            runOnUiThread {
                finish()
            }
        }

        @android.webkit.JavascriptInterface
        fun hapticFeedback() {
            runOnUiThread {
                runCatching {
                    rootLayout.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY)
                }
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
