/** Attachment bytes live in IndexedDB, never in the synchronous text autosave.
 * A snapshot is atomic and writes are ordered, including delete after save.
 * Keys include the account scope; no data is uploaded by saving a draft.
 */
export function createDraftFileStore(scope, indexedDB = globalThis.indexedDB) {
  let opening;
  let tail = Promise.resolve();
  const open = () => opening ??= new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new Error('Attachment storage is unavailable.'));
    const request = indexedDB.open('puter-mail-draft-files', 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { blocked = true; reject(new Error('Attachment storage is blocked by another window.')); };
  }).catch((error) => { opening = null; throw error; });
  const run = (id, mode, action) => {
    const result = tail.catch(() => {}).then(async () => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('files', mode);
        const request = action(tx.objectStore('files'), [String(scope), id]);
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Attachment storage failed.'));
      });
    });
    tail = result;
    return result;
  };
  return {
    load: (id) => run(id, 'readonly', (store, key) => store.get(key)).then((files) => files ?? []),
    save: (id, files) => run(id, 'readwrite', (store, key) => store.put(files, key)).then(() => true),
    remove: (id) => run(id, 'readwrite', (store, key) => store.delete(key)),
  };
}
