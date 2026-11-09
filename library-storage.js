// Durable AniDash Watch guest library storage.
// localStorage is synchronous for immediate saves; IndexedDB is an independent
// recovery copy for cases where one browser storage area is evicted/corrupted.
(() => {
  "use strict";
  const DB_NAME = "anidash-watch-state";
  const OBJECT_STORE = "snapshots";
  const KEY = "current";
  let databasePromise = null;
  let writeQueue = Promise.resolve();

  function database() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (databasePromise) return databasePromise;
    databasePromise = new Promise(resolve => {
      try {
        const request = indexedDB.open(DB_NAME, 2);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
            request.result.createObjectStore(OBJECT_STORE);
          }
          if (!request.result.objectStoreNames.contains("manga-files")) {
            request.result.createObjectStore("manga-files");
          }
          if (!request.result.objectStoreNames.contains("manga-file-info")) {
            request.result.createObjectStore("manga-file-info");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return databasePromise;
  }
  async function load() {
    const db = await database();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const transaction = db.transaction(OBJECT_STORE, "readonly");
        const req = transaction.objectStore(OBJECT_STORE).get(KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  async function save(snapshot) {
    const value = JSON.parse(JSON.stringify(snapshot));
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      const db = await database();
      if (!db) return false;
      return new Promise(resolve => {
        try {
          const tx = db.transaction(OBJECT_STORE, "readwrite");
          tx.objectStore(OBJECT_STORE).put(value, KEY);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch (_) { resolve(false); }
      });
    });
    return writeQueue;
  }

  async function saveMangaFile(file) {
    if (!(file instanceof Blob) || !file.size || file.size > 500_000_000)
      throw new Error("Choose a CBZ file up to 500 MB.");
    const db = await database();
    if (!db) throw new Error("Offline file storage isn't supported by this browser.");
    const name = String(file.name || "manga.cbz").replace(/[\\/]/g, "_").slice(0, 180);
    const id = name + ":" + file.size + ":" + Number(file.lastModified || 0);
    const info = { id, name, size: file.size, addedAt: Date.now() };
    await new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(["manga-files", "manga-file-info"], "readwrite");
        tx.objectStore("manga-files").put(file, id);
        tx.objectStore("manga-file-info").put(info, id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("Offline storage failed."));
        tx.onabort = () => reject(tx.error || new Error("Offline storage is full."));
      } catch (error) { reject(error); }
    });
    return info;
  }
  async function listMangaFiles() {
    const db = await database();
    if (!db) return [];
    return new Promise(resolve => {
      try {
        const tx = db.transaction("manga-file-info", "readonly");
        const req = tx.objectStore("manga-file-info").getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a,b) => b.addedAt-a.addedAt));
        req.onerror = () => resolve([]);
      } catch (_) { resolve([]); }
    });
  }
  async function getMangaFile(id) {
    const db = await database();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx = db.transaction("manga-files", "readonly");
        const req = tx.objectStore("manga-files").get(String(id));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  async function deleteMangaFile(id) {
    const db = await database();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(["manga-files","manga-file-info"], "readwrite");
        tx.objectStore("manga-files").delete(String(id));
        tx.objectStore("manga-file-info").delete(String(id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }
  window.AniDashStorage = { load, save, saveMangaFile, listMangaFiles, getMangaFile, deleteMangaFile };
})();
