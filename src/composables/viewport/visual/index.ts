import {onBeforeUnmount, onMounted, readonly, ref} from "vue";

const APP_ROOT_SELECTOR = ".app";

/** Apply one visual-viewport snapshot without entering the component lifecycle. */
export function applyViewportSnapshot(
    appRoot: HTMLElement,
    viewport: {height: number; offsetTop: number},
): void {
  appRoot.style.setProperty("--visual-viewport-height", `${viewport.height}px`);
  appRoot.style.setProperty("--visual-viewport-offset-top", `${Math.max(0, viewport.offsetTop)}px`);
}

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
    const viewport = window.visualViewport ?? {
      height: getVisualViewportHeight(),
      offsetTop: 0,
    };
    height.value = viewport.height;
    applyViewportSnapshot(appRoot, viewport);
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
    // Native insets resize the WebView; this callback only re-syncs that actual viewport.
    if (nativeBridge) {
      nativeBridge.keyboardCallback = scheduleSync;
      if (nativeBridge.getKeyboardHeight() > 0) scheduleSync();
    }
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
    appRoot?.style.removeProperty("--visual-viewport-offset-top");
  });

  return {height: readonly(height), syncViewport};
}
