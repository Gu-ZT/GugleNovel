export function loadJson<T>(key: string, normalize: (value: unknown) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return normalize(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储失败（容量或隐私模式）时静默降级为内存态
  }
}
