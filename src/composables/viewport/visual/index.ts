import {onBeforeUnmount, onMounted, readonly, ref} from "vue";

const APP_ROOT_SELECTOR = ".app";

export interface NativeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
  keyboard: number;
}

interface NativeViewportBridge {
  insetCallback?: (insets: NativeInsets) => void;
  getInsets(): string;
}

interface NativeViewportWindow extends Window {
  __GUGLE_VIEWPORT__?: NativeViewportBridge;
}

export interface ViewportLayout {
  /** Height of the layout viewport; status-bar space is applied separately. */
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function finiteInset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getVisualViewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

/** Pure layout model shared by the runtime hook and its regression tests. */
export function calculateViewportLayout(
    visualViewport: {height: number; offsetTop: number},
    innerHeight: number,
    systemInsets: NativeInsets,
    isMobile = true,
): ViewportLayout {
  const height = Math.min(innerHeight, visualViewport.height);
  const bottom = isMobile
      ? Math.max(systemInsets.bottom, systemInsets.keyboard)
      : systemInsets.bottom;
  return {
    height,
    top: systemInsets.top,
    right: systemInsets.right,
    bottom,
    left: systemInsets.left,
  };
}

export function applyViewportLayout(appRoot: HTMLElement, layout: ViewportLayout): void {
  const setPixel = (name: string, value: number) => {
    appRoot.style.setProperty(name, `${Math.max(0, value)}px`);
  };
  setPixel("--viewport-height", layout.height);
  setPixel("--system-inset-top", layout.top);
  setPixel("--system-inset-right", layout.right);
  setPixel("--system-inset-bottom", layout.bottom);
  setPixel("--system-inset-left", layout.left);
}

/** Sync the application shell to exactly one native viewport/inset snapshot. */
export function useVisualViewport() {
  const height = ref(getVisualViewportHeight());
  const layout = ref<ViewportLayout>({
    height: getVisualViewportHeight(),
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  let appRoot: HTMLElement | null = null;
  let resizeFrame = 0;
  let nativeBridge: NativeViewportBridge | null = null;
  let nativeInsets: NativeInsets = {top: 0, right: 0, bottom: 0, left: 0, keyboard: 0};

  function syncViewport() {
    if (!appRoot) return;
    const viewport = window.visualViewport ?? {height: getVisualViewportHeight(), offsetTop: 0};
    const isMobile = window.matchMedia?.("(max-width: 719px)")?.matches ?? true;
    const next = calculateViewportLayout(viewport, window.innerHeight, nativeInsets, isMobile);
    height.value = next.height;
    layout.value = next;
    applyViewportLayout(appRoot, next);
  }

  function scheduleSync() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      syncViewport();
    });
  }

  function updateNativeInsets(insets: NativeInsets) {
    nativeInsets = {
      top: finiteInset(insets.top),
      right: finiteInset(insets.right),
      bottom: finiteInset(insets.bottom),
      left: finiteInset(insets.left),
      keyboard: finiteInset(insets.keyboard),
    };
    scheduleSync();
  }

  onMounted(() => {
    appRoot = document.querySelector<HTMLElement>(APP_ROOT_SELECTOR);
    const nativeWindow = window as NativeViewportWindow;
    nativeBridge = nativeWindow.__GUGLE_VIEWPORT__ ?? null;
    if (nativeBridge) {
      nativeBridge.insetCallback = updateNativeInsets;
      try {
        const value: unknown = JSON.parse(nativeBridge.getInsets());
        if (value && typeof value === "object") updateNativeInsets(value as NativeInsets);
      } catch {
        // Keep zero fallbacks in a plain browser or before the first Android inset.
      }
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
    if (nativeBridge) nativeBridge.insetCallback = undefined;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    if (!appRoot) return;
    for (const name of [
      "--viewport-height",
      "--system-inset-top",
      "--system-inset-right",
      "--system-inset-bottom",
      "--system-inset-left",
    ]) {
      appRoot.style.removeProperty(name);
    }
  });

  return {height: readonly(height), layout: readonly(layout), syncViewport};
}
