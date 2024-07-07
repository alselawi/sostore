var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class IDB {
    constructor(name) {
        const request = indexedDB.open(name);
        request.onupgradeneeded = function (event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(name)) {
                const objectStore = db.createObjectStore(name);
                objectStore.createIndex("idIndex", "_id", { unique: true });
            }
            if (!db.objectStoreNames.contains('metadata')) {
                db.createObjectStore('metadata');
            }
        };
        const dbp = this.pr(request);
        this.store = (txMode, callback) => dbp.then((db) => callback(db.transaction(name, txMode, { durability: "relaxed" }).objectStore(name)));
        this.metadataStore = (txMode, callback) => dbp.then((db) => callback(db.transaction('metadata', txMode, { durability: "relaxed" }).objectStore('metadata')));
    }
    /**
     * Converts IDB requests/transactions to promises.
     */
    pr(req) {
        return new Promise((resolve, reject) => {
            // @ts-ignore - file size hacks
            req.oncomplete = req.onsuccess = () => resolve(req.result);
            // @ts-ignore - file size hacks
            req.onabort = req.onerror = () => reject(req.error);
        });
    }
    /**
     * Converts cursor iterations to promises.
     */
    eachCursor(store, callback) {
        store.openCursor().onsuccess = function () {
            if (!this.result)
                return;
            callback(this.result);
            this.result.continue();
        };
        return this.pr(store.transaction);
    }
    /**
     * Get a value by its key.
     */
    get(key) {
        return this.store("readonly", (store) => this.pr(store.get(key)));
    }
    /**
     * Get values for a given set of keys.
     */
    getBulk(keys) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.store("readonly", (store) => __awaiter(this, void 0, void 0, function* () {
                return Promise.all(keys.map((x) => this.pr(store.get(x))));
            }));
        });
    }
    /**
     * Set a value with a key.
     */
    set(key, value) {
        return this.store("readwrite", (store) => {
            store.put(value, key);
            return this.pr(store.transaction);
        });
    }
    /**
     * Set multiple values at once. This is faster than calling set() multiple times.
     * It's also atomic – if one of the pairs can't be added, none will be added.
     */
    setBulk(entries) {
        return this.store("readwrite", (store) => {
            entries.forEach((entry) => store.put(entry[1], entry[0]));
            return this.pr(store.transaction);
        });
    }
    /**
     * Delete multiple keys at once.
     */
    delBulk(keys) {
        return this.store("readwrite", (store) => {
            keys.forEach((key) => store.delete(key));
            return this.pr(store.transaction);
        });
    }
    /**
     * Clear all values in the store.
     */
    clear() {
        return this.store("readwrite", (store) => {
            store.clear();
            return this.pr(store.transaction);
        });
    }
    /**
     * Get all keys in the store.
     */
    keys() {
        return this.store("readonly", (store) => __awaiter(this, void 0, void 0, function* () {
            // Fast path for modern browsers
            if (store.getAllKeys) {
                return this.pr(store.getAllKeys());
            }
            const items = [];
            yield this.eachCursor(store, (cursor) => items.push(cursor.key));
            return items;
        }));
    }
    /**
     * Get all documents in the store.
     */
    values() {
        return this.store("readonly", (store) => __awaiter(this, void 0, void 0, function* () {
            // Fast path for modern browsers
            if (store.getAll) {
                return this.pr(store.getAll());
            }
            const items = [];
            yield this.eachCursor(store, (cursor) => items.push(cursor.value));
            return items;
        }));
    }
    /**
     * Get key by ID
     */
    byID(_id) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.store("readonly", (store) => {
                return this.pr(store.index("idIndex").getKey(_id));
            });
        });
    }
    /**
     * Get length of the DB.
     */
    length() {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield this.keys()).length;
        });
    }
    /**
     * Set metadata with a key.
     */
    setMetadata(key, value) {
        return this.metadataStore("readwrite", (store) => {
            store.put(value, key);
            return this.pr(store.transaction);
        });
    }
    /**
     * Get metadata by its key.
     */
    getMetadata(key) {
        return this.metadataStore("readonly", (store) => this.pr(store.get(key)));
    }
    clearMetadata() {
        return this.metadataStore("readwrite", (store) => {
            store.clear();
            return this.pr(store.transaction);
        });
    }
}
