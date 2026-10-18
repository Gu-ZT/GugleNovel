import {onBeforeUnmount, onMounted, readonly, ref} from "vue";

const APP_ROOT_SELECTOR = ".app";

interface NativeViewportBridge {
  keyboardCallback?: (height: number) => void;
  getKeyboardHeight(): number;
}

interface NativeViewportWindow extends Window {
  __GUGLE_VIEWPORT__?: NativeViewportBridge;
}

function getVisualViewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

/** 同步应用壳层到 WebView 的可视区域，避免 Android 软键盘遮住底部编辑器。 */
export function useVisualViewport() {
  const height = ref(getVisualViewportHeight());
  let appRoot: HTMLElement | null = null;
  let resizeFrame = 0;
  let nativeBridge: NativeViewportBridge | null = null;

  function syncViewport() {
    if (!appRoot) return;
    // Android reports the IME inset directly. visualViewport can keep its old height
    // while the keyboard animates, so the shell must also subtract this native inset.
    if (!document.documentElement.style.getPropertyValue("--native-keyboard-height")) {
      document.documentElement.style.setProperty("--native-keyboard-height", "0px");
    }
    const nextHeight = getVisualViewportHeight();
    height.value = nextHeight;
    appRoot.style.setProperty("--visual-viewport-height", `${nextHeight}px`);
  }

  function scheduleSync() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      syncViewport();
    });
  }

  onMounted(() => {
    appRoot = document.querySelector<HTMLElement>(APP_ROOT_SELECTOR);
    const nativeWindow = window as NativeViewportWindow;
    nativeBridge = nativeWindow.__GUGLE_VIEWPORT__ ?? null;
    const updateKeyboardHeight = (keyboardHeight: number) => {
      if (typeof keyboardHeight !== "number" || !Number.isFinite(keyboardHeight)) return;
      document.documentElement.style.setProperty(
          "--native-keyboard-height",
          `${Math.max(0, keyboardHeight)}px`,
      );
      scheduleSync();
    };
    // Android calls this page-owned function after each IME inset change.
    if (nativeBridge) {
      nativeBridge.keyboardCallback = updateKeyboardHeight;
      const currentKeyboardHeight = nativeBridge.getKeyboardHeight();
      if (currentKeyboardHeight > 0) updateKeyboardHeight(currentKeyboardHeight);
    }
    updateKeyboardHeight(0);
    syncViewport();
    window.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("scroll", scheduleSync);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("resize", scheduleSync);
    window.visualViewport?.removeEventListener("resize", scheduleSync);
    window.visualViewport?.removeEventListener("scroll", scheduleSync);
    if (nativeBridge) nativeBridge.keyboardCallback = undefined;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    appRoot?.style.removeProperty("--visual-viewport-height");
    document.documentElement.style.removeProperty("--native-keyboard-height");
  });

  return {height: readonly(height), syncViewport};
}
