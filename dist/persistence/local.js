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
    constructor({ name }) {
        const request = indexedDB.open(name);
        request.onupgradeneeded = function (event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(name)) {
                const objectStore = db.createObjectStore(name);
                objectStore.createIndex("idIndex", "_id", { unique: true });
            }
            if (!db.objectStoreNames.contains("metadata")) {
                db.createObjectStore("metadata");
            }
        };
        const dbp = this.pr(request);
        this.store = (txMode, callback) => dbp.then((db) => callback(db
            .transaction(name, txMode, { durability: "relaxed" })
            .objectStore(name)));
        this.metadataStore = (txMode, callback) => dbp.then((db) => callback(db
            .transaction("metadata", txMode, { durability: "relaxed" })
            .objectStore("metadata")));
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
     * Set multiple values at once. This is faster than calling set() multiple times.
     * It's also atomic – if one of the pairs can't be added, none will be added.
     */
    put(entries) {
        return this.store("readwrite", (store) => {
            entries.forEach((entry) => store.put(entry[1], entry[0]));
            return this.pr(store.transaction);
        });
    }
    /**
     * Get all documents in the store.
     */
    getAll() {
        return this.store("readonly", (store) => __awaiter(this, void 0, void 0, function* () {
            let rows = [];
            if (store.getAll) {
                rows = yield this.pr(store.getAll());
            }
            else {
                yield this.eachCursor(store, (cursor) => rows.push(cursor.value));
            }
            return rows;
        }));
    }
    getVersion() {
        return __awaiter(this, void 0, void 0, function* () {
            return Number((yield this.getMetadata("version")) || 0);
        });
    }
    putVersion(version) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.setMetadata("version", JSON.stringify(version));
        });
    }
    getDeferred() {
        return __awaiter(this, void 0, void 0, function* () {
            return JSON.parse((yield this.getMetadata("deferred")) || "[]");
        });
    }
    putDeferred(arr) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.setMetadata("deferred", JSON.stringify(arr));
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
    /**
     * Clear all values in the store.
     */
    clear() {
        return this.store("readwrite", (store) => {
            store.clear();
            return this.pr(store.transaction);
        });
    }
    clearMetadata() {
        return this.metadataStore("readwrite", (store) => {
            store.clear();
            return this.pr(store.transaction);
        });
    }
}
