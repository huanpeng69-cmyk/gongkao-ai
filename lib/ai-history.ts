export type HistoryKind = "ai" | "image";

export type HistoryEntry<T = unknown> = {
  key: string;
  kind: HistoryKind;
  value: T;
  label?: string;
  createdAt: number;
  lastUsedAt: number;
  hits: number;
  size: number;
};

type ListHistoryOptions = {
  kind?: HistoryKind;
  limit?: number;
};

const DB_NAME = "gongkao-ai-history";
const DB_VERSION = 1;
const STORE_NAME = "entries";

const LIMITS: Record<HistoryKind, { maxEntries: number; maxBytes: number }> = {
  ai: { maxEntries: 180, maxBytes: 2_500_000 },
  image: { maxEntries: 14, maxBytes: 36_000_000 },
};

function hasIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openHistoryDb() {
  if (!hasIndexedDb()) return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("kind", "kind", { unique: false });
        store.createIndex("lastUsedAt", "lastUsedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function hashString(input: string) {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function normalizeForKey(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length > 4096) {
      return { type: "large-string", length: value.length, hash: hashString(value) };
    }
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForKey);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeForKey((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

function stableStringify(value: unknown) {
  return JSON.stringify(normalizeForKey(value));
}

function getValueSize(value: unknown) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export function createHistoryKey(kind: HistoryKind, payload: unknown) {
  return `${kind}:${hashString(stableStringify(payload))}`;
}

export function getAiConfigFingerprint() {
  if (typeof window === "undefined") return {};
  return {
    provider: localStorage.getItem("gongkao-ai-protocol") || "openai",
    base: localStorage.getItem("gongkao-ai-base") || "",
    model: localStorage.getItem("gongkao-ai-model") || "",
    auth: localStorage.getItem("gongkao-ai-auth") || "bearer",
  };
}

export function getImageConfigFingerprint() {
  if (typeof window === "undefined") return {};
  return {
    base: localStorage.getItem("gongkao-image-base") || localStorage.getItem("gongkao-ai-base") || "",
    model: localStorage.getItem("gongkao-image-model") || "gpt-image-1",
    auth: localStorage.getItem("gongkao-image-auth") || "bearer",
    size: localStorage.getItem("gongkao-image-size") || "1024x1024",
  };
}

export async function readHistory<T>(key: string) {
  try {
    const db = await openHistoryDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const entry = await requestToPromise<HistoryEntry<T> | undefined>(store.get(key));

    if (!entry) {
      await transactionDone(tx);
      return null;
    }

    const nextEntry: HistoryEntry<T> = {
      ...entry,
      lastUsedAt: Date.now(),
      hits: (entry.hits || 0) + 1,
    };
    store.put(nextEntry);
    await transactionDone(tx);
    return nextEntry.value;
  } catch {
    return null;
  }
}

export async function listHistory<T = unknown>(options: ListHistoryOptions = {}) {
  try {
    const db = await openHistoryDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const all = await requestToPromise<HistoryEntry<T>[]>(store.getAll());
    await transactionDone(tx);

    return all
      .filter((entry) => !options.kind || entry.kind === options.kind)
      .sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt))
      .slice(0, options.limit || all.length);
  } catch {
    return [];
  }
}

export async function deleteHistory(key: string) {
  try {
    const db = await openHistoryDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    await transactionDone(tx);
  } catch {
    // History deletion is best-effort.
  }
}

export async function writeHistory<T>(kind: HistoryKind, key: string, value: T, label?: string) {
  try {
    const db = await openHistoryDb();
    const now = Date.now();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const existing = await requestToPromise<HistoryEntry<T> | undefined>(store.get(key));

    const entry: HistoryEntry<T> = {
      key,
      kind,
      value,
      label,
      createdAt: existing?.createdAt || now,
      lastUsedAt: now,
      hits: existing?.hits || 0,
      size: getValueSize(value),
    };

    store.put(entry);
    await transactionDone(tx);
    await compactHistory(kind);
  } catch {
    // Cache misses should never block the learning flow.
  }
}

export async function compactHistory(kind?: HistoryKind) {
  try {
    const db = await openHistoryDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const all = await requestToPromise<HistoryEntry[]>(store.getAll());
    const kinds: HistoryKind[] = kind ? [kind] : ["ai", "image"];

    kinds.forEach((currentKind) => {
      const limit = LIMITS[currentKind];
      const entries = all
        .filter((entry) => entry.kind === currentKind)
        .sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt));

      let totalSize = entries.reduce((sum, entry) => sum + (entry.size || 0), 0);
      const toDelete: string[] = [];

      entries.forEach((entry, index) => {
        if (index >= limit.maxEntries) {
          toDelete.push(entry.key);
          totalSize -= entry.size || 0;
        }
      });

      for (let i = entries.length - 1; i >= 1 && totalSize > limit.maxBytes; i -= 1) {
        const entry = entries[i];
        if (!toDelete.includes(entry.key)) {
          toDelete.push(entry.key);
          totalSize -= entry.size || 0;
        }
      }

      toDelete.forEach((key) => store.delete(key));
    });

    await transactionDone(tx);
  } catch {
    // Best-effort cache compaction.
  }
}

export function isCacheableAiResult(value: unknown) {
  const item = value as Record<string, unknown> | null;
  if (!item || typeof item !== "object") return false;
  if (item.error || item.apiError) return false;
  if (item.source === "local" || item.source === "local_fallback") return false;
  return Boolean(item.analysis || item.answerSummary || item.title || item.suggestion);
}

export function isCacheableImageResult(value: unknown) {
  const item = value as Record<string, unknown> | null;
  if (!item || typeof item !== "object") return false;
  if (item.error || item.detail === "生图接口未配置") return false;
  return Boolean(item.imageUrl || item.b64Json);
}

export function withHistoryHit<T extends object>(value: T): T & { historyHit: true } {
  return { ...value, historyHit: true };
}
