const DB_NAME = "markcard-asset-library-v1";
const DB_VERSION = 1;
const STORE_NAME = "assets";

let databasePromise = null;

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment"));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "assetId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open the asset database"));
    request.onblocked = () => reject(new Error("The asset database is blocked by another tab"));
  });

  return databasePromise;
}

function runTransaction(mode, executor) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let result;
        try {
          result = executor(store);
        } catch (error) {
          reject(error);
          return;
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error("Asset database transaction failed"));
        transaction.onabort = () => reject(transaction.error || new Error("Asset database transaction was aborted"));
      }),
  );
}

export function listBrowserAssets() {
  return runTransaction("readonly", (store) => {
    const request = store.getAll();
    const holder = { value: [] };
    request.onsuccess = () => {
      holder.value = Array.isArray(request.result) ? request.result : [];
    };
    return holder;
  }).then((holder) => holder.value);
}

function plainRecord(asset) {
  // IndexedDB cannot structured-clone Vue reactive proxies.
  return JSON.parse(JSON.stringify(asset));
}

export function saveBrowserAsset(asset) {
  return runTransaction("readwrite", (store) => {
    store.put(plainRecord(asset));
  });
}

export function saveBrowserAssets(assets) {
  if (!assets.length) return Promise.resolve();
  return runTransaction("readwrite", (store) => {
    for (const asset of assets) store.put(plainRecord(asset));
  });
}

export function deleteBrowserAsset(assetId) {
  return runTransaction("readwrite", (store) => {
    store.delete(assetId);
  });
}

export function clearBrowserAssets() {
  return runTransaction("readwrite", (store) => {
    store.clear();
  });
}
