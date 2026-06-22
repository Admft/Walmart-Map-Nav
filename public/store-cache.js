const DB_NAME = 'walmart-map-nav';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('stores')) {
        db.createObjectStore('stores', { keyPath: 'id' });
      }
    };
  });
}

export async function listCachedStores() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('stores', 'readonly');
    const req = tx.objectStore('stores').getAllKeys();
    req.onsuccess = () => resolve(req.result.map(String).sort((a, b) => Number(a) - Number(b)));
    req.onerror = () => reject(req.error);
  });
}

export async function getStore(storeId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('stores', 'readonly');
    const req = tx.objectStore('stores').get(String(storeId));
    req.onsuccess = () => resolve(req.result?.mapData ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putStore(storeId, mapData) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('stores', 'readwrite');
    tx.objectStore('stores').put({
      id: String(storeId),
      mapData,
      savedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
