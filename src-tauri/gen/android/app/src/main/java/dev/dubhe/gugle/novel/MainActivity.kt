package dev.dubhe.gugle.novel

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var insetSnapshot = ViewportInset()

  /** Data exposed to window.__GUGLE_VIEWPORT__; values are CSS pixels. */
  data class ViewportInset(
    val top: Float = 0f,
    val right: Float = 0f,
    val bottom: Float = 0f,
    val left: Float = 0f,
    val keyboard: Float = 0f,
  ) {
    fun toJson(): String =
      "{\"top\":$top,\"right\":$right,\"bottom\":$bottom,\"left\":$left,\"keyboard\":$keyboard}"
  }

  inner class ViewportBridge {
    @JavascriptInterface
    fun getInsets(): String = insetSnapshot.toJson()
  }

  private val viewportBridge = ViewportBridge()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(0x17171A),
      navigationBarStyle = SystemBarStyle.dark(0x17171A),
    )
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(viewportBridge, "__GUGLE_VIEWPORT__")
    // Keep the WebView full-screen and expose insets as one page layout snapshot.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      publishInsets(webView, insets)
      insets
    }
    ViewCompat.setWindowInsetsAnimationCallback(
      webView,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          publishInsets(webView, insets)
          return insets
        }
      },
    )
    webView.requestApplyInsets()
  }

  private fun publishInsets(view: WebView, insets: WindowInsetsCompat) {
    val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
    val navigation = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
    val tappable = insets.getInsets(WindowInsetsCompat.Type.tappableElement())
    val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
    val density = resources.displayMetrics.density
    if (density <= 0f) return
    insetSnapshot = ViewportInset(
      top = systemBars.top / density,
      right = systemBars.right / density,
      bottom = maxOf(navigation.bottom, tappable.bottom) / density,
      left = systemBars.left / density,
      keyboard = ime.bottom / density,
    )
    val script = "window.__GUGLE_VIEWPORT__ && " +
      "window.__GUGLE_VIEWPORT__.insetCallback && " +
      "window.__GUGLE_VIEWPORT__.insetCallback(${insetSnapshot.toJson()})"
    view.post { view.evaluateJavascript(script, null) }
    // The page can attach its callback after the first inset dispatch or after reload.
    view.postDelayed({ view.evaluateJavascript(script, null) }, 300)
  }
}
