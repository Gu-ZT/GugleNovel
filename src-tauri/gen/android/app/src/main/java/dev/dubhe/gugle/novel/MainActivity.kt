package dev.dubhe.gugle.novel

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var keyboardHeightDp = 0f

  /** Exposed as window.__GUGLE_VIEWPORT__; the page owns the callback function. */
  inner class ViewportBridge {
    @JavascriptInterface
    fun getKeyboardHeight(): Float = keyboardHeightDp
  }

  private val viewportBridge = ViewportBridge()

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(viewportBridge, "__GUGLE_VIEWPORT__")
    // Keep the WebView at full size; the page shell follows visualViewport and the
    // app tab bar stays above the keyboard. Never pad this view twice.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      reportKeyboardHeight(webView, ime.bottom)
      insets
    }
    ViewCompat.setWindowInsetsAnimationCallback(
      webView,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          reportKeyboardHeight(webView, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
          return insets
        }
      },
    )
    webView.requestApplyInsets()
  }

  private fun reportKeyboardHeight(view: WebView, pixels: Int) {
    val density = resources.displayMetrics.density
    if (density <= 0f) return
    val cssHeight = pixels / density
    keyboardHeightDp = cssHeight
    val script = "window.__GUGLE_VIEWPORT__ && " +
      "window.__GUGLE_VIEWPORT__.keyboardCallback && " +
      "window.__GUGLE_VIEWPORT__.keyboardCallback($cssHeight)"
    view.post {
      view.evaluateJavascript(script, null)
      // Dispatch again after the keyboard animation and page startup.
      view.postDelayed({ view.evaluateJavascript(script, null) }, 250)
    }
  }
}
