import {onBeforeUnmount, onMounted, readonly, ref} from "vue";

const APP_ROOT_SELECTOR = ".app";

function getVisualViewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

/** 同步应用壳层到 WebView 的可视区域，避免 Android 软键盘遮住底部编辑器。 */
export function useVisualViewport() {
  const height = ref(getVisualViewportHeight());
  let appRoot: HTMLElement | null = null;
  let resizeFrame = 0;

  function syncViewport() {
    const nextHeight = getVisualViewportHeight();
    height.value = nextHeight;
    if (!appRoot) return;
    const top = appRoot.scrollHeight > appRoot.clientHeight
        ? Math.max(0, appRoot.getBoundingClientRect().top)
        : 0;
    // A scrolled visual viewport may hide the layout-space top; use the compositor offset
    // when the shell itself has not moved.
    const visualOffsetTop = window.visualViewport?.offsetTop ?? 0;
    const effectiveTop = top || Math.max(0, visualOffsetTop);
    appRoot.style.setProperty("--app-offset-top", `${effectiveTop}px`);
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
    syncViewport();
    window.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("scroll", scheduleSync);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("resize", scheduleSync);
    window.visualViewport?.removeEventListener("resize", scheduleSync);
    window.visualViewport?.removeEventListener("scroll", scheduleSync);
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    appRoot?.style.removeProperty("--app-offset-top");
    appRoot?.style.removeProperty("--visual-viewport-height");
  });

  return {height: readonly(height), syncViewport};
}
