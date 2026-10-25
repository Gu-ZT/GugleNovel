/**
 * 插图二进制仓库。消息只保存 imageId，图片本体走 IndexedDB，
 * 避免 base64 撑爆 localStorage 的 5MB 配额。
 */
export interface StoredImage {
  id: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}

const DB_NAME = "gugle-novel-images";
const DB_VERSION = 1;
const STORE_NAME = "images";

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, {keyPath: "id"});
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("打开图片仓库失败"));
    request.onblocked = () => reject(new Error("图片仓库被其他页面占用，请关闭其他窗口后重试"));
  });
  // 打开失败时清空缓存，允许后续操作重新尝试
  databasePromise.catch(() => {
    databasePromise = null;
  });
  return databasePromise;
}

function runTransaction<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | undefined> {
  return openDatabase().then((database) => new Promise<T | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    let result: T | undefined;
    request.onsuccess = () => {
      result = request.result;
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error("图片仓库操作失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("图片仓库操作被中断"));
  }));
}

export function createImageId(): string {
  return globalThis.crypto?.randomUUID?.()
      ?? `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 保存图片并返回其 id；写入失败会抛错，禁止返回没有数据的引用。 */
export async function saveImage(blob: Blob, mimeType: string): Promise<string> {
  const id = createImageId();
  const record: StoredImage = {id, blob, mimeType, createdAt: Date.now()};
  await runTransaction("readwrite", (store) => store.put(record) as IDBRequest<IDBValidKey>);
  return id;
}

export async function loadImage(id: string): Promise<StoredImage | null> {
  const record = await runTransaction<StoredImage | undefined>("readonly", (store) => store.get(id));
  return record ?? null;
}

export async function deleteImage(id: string): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(id) as IDBRequest<undefined>);
}

/** 批量删除无主图片；单个失败不影响其余删除，返回失败的 id 供日志定位。 */
export async function deleteImages(ids: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await deleteImage(id);
    } catch {
      failed.push(id);
    }
  }
  return failed;
}
