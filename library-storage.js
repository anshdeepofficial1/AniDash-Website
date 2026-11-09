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
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
            request.result.createObjectStore(OBJECT_STORE);
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
  window.AniDashStorage = { load, save };
})();
