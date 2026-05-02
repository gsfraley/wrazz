const DB_NAME = "wrazz-drafts";
const DB_VERSION = 1;
const STORE = "drafts";

export interface StoredDraft {
  path: string;
  title: string;
  content: string;
  tags: string[];
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "path" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

export async function getDraft(path: string): Promise<StoredDraft | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(path);
    req.onsuccess = () => resolve(req.result as StoredDraft | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDraft(path: string, title: string, content: string, tags: string[]): Promise<void> {
  const db = await openDb();
  const entry: StoredDraft = { path, title, content, tags, savedAt: Date.now() };
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllDraftPaths(): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

export async function clearDraft(path: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(path);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
