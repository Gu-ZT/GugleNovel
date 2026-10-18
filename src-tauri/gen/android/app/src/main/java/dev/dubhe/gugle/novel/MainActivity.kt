package dev.dubhe.gugle.novel

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

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
    // The WebView fills the Activity's content area, so padding here shrinks the
    // layout viewport without relying on visualViewport resize support.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.updatePadding(
        left = bars.left,
        top = bars.top,
        right = bars.right,
        bottom = maxOf(bars.bottom, ime.bottom),
      )
      val coveredHeight = if (ime.bottom > 0) {
        (view.height - ime.top).coerceIn(0, view.height)
      } else {
        ime.bottom
      }
      reportKeyboardHeight(webView, coveredHeight)
      insets
    }
    ViewCompat.setWindowInsetsAnimationCallback(
      webView,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          // Animate from the keyboard's leading edge; the layout event supplies the final value.
          val bars = ViewCompat.getRootWindowInsets(webView)
            ?.getInsets(WindowInsetsCompat.Type.systemBars())
          val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
          val pixels = if (ime.bottom > 0) webView.height - ime.top else bars?.bottom ?: 0
          reportKeyboardHeight(webView, pixels)
          return insets
        }
      },
    )
    webView.requestApplyInsets()
  }

  private fun reportKeyboardHeight(view: WebView, pixels: Int) {
    val pageView = this.webView
    val density = resources.displayMetrics.density
    if (pageView == null || density <= 0f) return
    val cssHeight = pixels / density
    keyboardHeightDp = cssHeight
    val script = "window.__GUGLE_VIEWPORT__ && " +
      "window.__GUGLE_VIEWPORT__.keyboardCallback && " +
      "window.__GUGLE_VIEWPORT__.keyboardCallback($cssHeight)"
    view.post {
      pageView.evaluateJavascript(script, null)
      // The page may attach its callback after the first inset dispatch.
      pageView.postDelayed({ pageView.evaluateJavascript(script, null) }, 250)
    }
  }
}
