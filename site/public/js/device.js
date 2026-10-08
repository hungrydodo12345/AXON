/**
 * device.js — the OPT-IN encrypted copy kept in this browser (IndexedDB).
 *
 * What's stored is the very same encrypted vault text that would go in a .axon
 * file — never plaintext — plus two harmless labels (revision, save time) so
 * the welcome screen can say "Saved copy · revision 3 · yesterday". It exists
 * only if the user switched it on in Settings, and can be deleted any time.
 */

const DB_NAME = "axon-device";
const STORE = "copies";

export const deviceStorageAvailable = () => typeof indexedDB !== "undefined" && indexedDB !== null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "slot" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Couldn't open this browser's storage."));
    req.onblocked = () => reject(new Error("Browser storage is busy. Close other AXON tabs and try again."));
  });
}

async function run(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let out;
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => { out = req.result; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error || new Error("Couldn't write to this browser's storage."));
      tx.onabort = () => reject(tx.error || new Error("The browser refused to save (it may be full)."));
    });
  } finally {
    db.close();
  }
}

/** @param {{slot:string,revision:number,savedAt:string,text:string}} copy */
export const putCopy = (copy) => run("readwrite", (s) => s.put({ ...copy, bytes: copy.text.length }));
export const getCopy = (slot) => run("readonly", (s) => s.get(slot));
export const deleteCopy = (slot) => run("readwrite", (s) => s.delete(slot));
export async function listCopies() {
  if (!deviceStorageAvailable()) return [];
  try {
    // Don't create an (empty) database just by looking: if it was never made, there's nothing to list.
    if (typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === DB_NAME)) return [];
    }
    return (await run("readonly", (s) => s.getAll())) ?? [];
  } catch { return []; }
}

/** Is the device copy strictly newer than the file's last save? (1s of slack for clock rounding) */
export function deviceCopyIsNewer(copy, vault) {
  if (!copy?.savedAt || !vault?.updatedAt) return false;
  return new Date(copy.savedAt).getTime() > new Date(vault.updatedAt).getTime() + 1000;
}
