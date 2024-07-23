var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Observable } from "./observable";
import { debounce } from "./debounce";
import { Document } from "./model";
export class Store {
    constructor({ debounceRate, model, encode, decode, onSyncStart, onSyncEnd, localPersistence, remotePersistence, } = {}) {
        this.deferredPresent = false;
        this.onSyncStart = () => { };
        this.onSyncEnd = () => { };
        this.$$observableObject = new Observable([]);
        this.$$changes = [];
        this.$$loaded = false;
        this.$$debounceRate = 100;
        this.$$lastProcessChanges = 0;
        this.$$model = Document;
        this.$$encode = (x) => x;
        this.$$decode = (x) => x;
        this.new = this.$$model.new;
        this.sync = debounce(this.$$sync.bind(this), this.$$debounceRate);
        this.$$model = model || Document;
        if (onSyncStart) {
            this.onSyncStart = onSyncStart;
        }
        if (onSyncEnd) {
            this.onSyncEnd = onSyncEnd;
        }
        if (encode) {
            this.$$encode = encode;
        }
        if (decode) {
            this.$$decode = decode;
        }
        if (typeof debounceRate === "number") {
            this.$$debounceRate = debounceRate;
        }
        if (localPersistence) {
            this.$$localPersistence = localPersistence;
            this.$$loadFromLocal();
            this.$$setupObservers();
        }
        if (remotePersistence) {
            this.$$remotePersistence = remotePersistence;
        }
    }
    /**
     * Serializes an item of type T into an encoded JSON string.
     * Date objects are converted to a custom format before encoding.
     * @param item An instance of type T which extends Document.
     * @returns An encoded JSON string representing the item.
     */
    $$serialize(item) {
        const stripped = item._stripDefaults ? item._stripDefaults() : item;
        const str = JSON.stringify(stripped, function (key, value) {
            if (value === undefined)
                return undefined;
            if (value === null)
                return null;
            if (typeof this[key].getTime === "function")
                return { $$date: this[key].getTime() };
            return value;
        });
        return this.$$encode(str);
    }
    /**
     * Decodes a serialized string, parses it into a JavaScript object, and converts custom date formats back into Date objects.
     * @param line A string representing the serialized data.
     * @returns A new instance of the model with the deserialized data.
     */
    $$deserialize(line) {
        line = this.$$decode(line);
        const item = JSON.parse(line, (key, val) => {
            if (key === "$$date")
                return new Date(val);
            const t = typeof val;
            if (t === "string" || t === "number" || t === "boolean" || val === null)
                return val;
            if (val && val.$$date)
                return val.$$date;
            return val;
        });
        return this.$$model.new(item);
    }
    /**
     * Loads data from an IndexedDB instance, deserializes it, and updates the observable array silently without triggering observers.
     */
    $$loadFromLocal() {
        return __awaiter(this, void 0, void 0, function* () {
            // Check if IndexedDB instance is available
            if (!this.$$localPersistence)
                return;
            // Retrieve values from IndexedDB and deserialize them
            const deserialized = yield Promise.all((yield this.$$localPersistence.getAll()).map((x) => this.$$deserialize(x)));
            // Update the observable array silently with deserialized data
            this.$$observableObject.silently((o) => {
                o.splice(0, o.length, ...deserialized);
                this.$$loaded = true;
            });
        });
    }
    $$processChanges() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.$$localPersistence)
                return;
            if (this.$$changes.length === 0)
                return;
            this.onSyncStart();
            this.$$lastProcessChanges = Date.now();
            const toWrite = [];
            const toDeffer = [];
            const changesToProcess = [...this.$$changes]; // Create a copy of changes to process
            this.$$changes = []; // Clear the original changes array
            for (let index = 0; index < changesToProcess.length; index++) {
                const change = changesToProcess[index];
                const item = change.snapshot[change.path[0]];
                const serializedLine = this.$$serialize(item);
                toWrite.push([item.id, serializedLine]);
                toDeffer.push({
                    ts: Date.now(),
                    id: item.id,
                });
            }
            yield this.$$localPersistence.put(toWrite);
            let deferredArray = yield this.$$localPersistence.getDeferred();
            if (this.isOnline &&
                this.$$remotePersistence &&
                deferredArray.length === 0) {
                try {
                    yield this.$$remotePersistence.put(toWrite);
                    this.onSyncEnd();
                    return;
                }
                catch (e) {
                    console.error("Will defer updates, due to error during sending.");
                    console.error(e);
                }
            }
            /**
             * If:
             * 1. There are already deferred updates
             * 2. There's an error during sending updates to the remote server
             * 3. We're offline
             */
            if (this.$$remotePersistence) {
                yield this.$$localPersistence.putDeferred(deferredArray.concat(...toDeffer));
                this.deferredPresent = true;
            }
            this.onSyncEnd();
        });
    }
    $$setupObservers() {
        this.$$observableObject.observe((changes) => __awaiter(this, void 0, void 0, function* () {
            for (const change of changes) {
                if (change.type === "insert" || change.type === "update") {
                    // remove existing changes for the same item
                    this.$$changes = this.$$changes.filter((x) => x.snapshot[x.path[0]].id !==
                        change.snapshot[change.path[0]].id);
                    this.$$changes.push(change);
                }
            }
            const nextRun = this.$$lastProcessChanges + this.$$debounceRate - Date.now();
            setTimeout(() => {
                this.$$processChanges();
            }, nextRun > 0 ? nextRun : 0);
        }));
    }
    /**
     *
     * Sync mechanism and explanation:
     * The remote sync server maintains a change log, where set of changes (for a set of rows) are stored.
     * Each change is referred as a version.
     * version number is actually a timestamp.
     *
     * By comparing the local version with the remote version, we can determine if there are any changes to be fetched.
     * If there's a difference, we fetch the changed rows from the remote server since our local version.
     * Hence, our local version is updated to the latest version only through this mechanism
     * this is why we may get redundant updates from the remote server
     * (since we may send updates but not ask for the latest version)
     *
     * Local updates are automatically sent to the remote server.
     * If there's an error during sending updates, the updates are stored in a deferred array.
     * ***************************************************************************
     *
     * The sync mechanism is as follows:
     * 1. Fetch the local version
     * 2. Fetch the remote version
     * 3. If the versions match, there's nothing to do
     * 4. If the versions don't match, fetch the updates from the remote server (this would also give us the latest version number)
     * 5. check the deferred array for items that have not been sent (due to an error, or offline)
     * 6. compare the local and remote updates for conflicts (latest write wins)
     * 7. write the remote updates to the local store
     * 8. write the local updates to the remote store
     * 9. reset the deferred array (set it to empty)
     * 10. set the local version to the remote version that has been given when fetching for new documents (step 4)
     * 11. re-load the local data to the observable array
     * 12. return the number of pushed and pulled updates
     * **************************************************************************
     */
    $$syncTry() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.$$localPersistence) {
                return {
                    exception: "Local persistence not available",
                };
            }
            if (!this.$$remotePersistence) {
                return {
                    exception: "Remote persistence not available",
                };
            }
            if (!this.isOnline) {
                return {
                    exception: "Offline",
                };
            }
            try {
                const localVersion = yield this.$$localPersistence.getVersion();
                const remoteVersion = yield this.$$remotePersistence.getVersion();
                let deferredArray = yield this.$$localPersistence.getDeferred();
                let conflicts = 0;
                if (localVersion === remoteVersion && deferredArray.length === 0) {
                    return {
                        exception: "Nothing to sync",
                    };
                }
                // fetch updates since our local version
                const remoteUpdates = yield this.$$remotePersistence.getSince(localVersion);
                // check for conflicts
                deferredArray = deferredArray.filter((x) => {
                    var _a;
                    const conflict = remoteUpdates.rows.findIndex((y) => y.id === x.id);
                    // take row-specific version if available, otherwise rely on latest version
                    const comparison = Number(((_a = remoteUpdates.rows[conflict]) === null || _a === void 0 ? void 0 : _a.ts) || remoteVersion);
                    if (conflict === -1) {
                        return true;
                    }
                    else if (x.ts > comparison) {
                        // there's a conflict, but the local change is newer
                        remoteUpdates.rows.splice(conflict, 1);
                        conflicts++;
                        return true;
                    }
                    else {
                        // there's a conflict, and the remote change is newer
                        conflicts++;
                        return false;
                    }
                });
                // now we have local and remote to update
                // we should start with remote
                yield this.$$localPersistence.put(remoteUpdates.rows.map((row) => [row.id, row.data]));
                // then local
                const updatedRows = new Map();
                for (const d of deferredArray) {
                    updatedRows.set(d.id, yield this.$$localPersistence.getOne(d.id));
                    // latest deferred write wins since it would overwrite the previous one
                }
                yield this.$$remotePersistence.put([...updatedRows.keys()].map((x) => [x, updatedRows.get(x)]));
                // reset deferred
                yield this.$$localPersistence.putDeferred([]);
                this.deferredPresent = false;
                // set local version to the version given by the current request
                // this might be outdated as soon as this functions ends
                // that's why this function will run on a while loop (below)
                yield this.$$localPersistence.putVersion(remoteUpdates.version);
                // but if we had deferred updates then the remoteUpdates.version is outdated
                // so we need to fetch the latest version again
                // however, we should not do this in the same run since there might be updates
                // from another client between the time we fetched the remoteUpdates and the
                // time we sent deferred updates
                // so every sync should be followed by another sync
                // until the versions match
                // this is why there's another private sync method
                // finally re-load local data
                yield this.$$loadFromLocal();
                let pushed = deferredArray.length;
                let pulled = remoteUpdates.rows.length;
                return { pushed, pulled, conflicts };
            }
            catch (e) {
                console.error(e);
                return {
                    exception: "Error during synchronization",
                };
            }
        });
    }
    $$sync() {
        return __awaiter(this, void 0, void 0, function* () {
            this.onSyncStart();
            let tries = [];
            try {
                let exceptionOccurred = false;
                while (!exceptionOccurred) {
                    const result = yield this.$$syncTry();
                    if (result.exception) {
                        exceptionOccurred = true;
                    }
                    tries.push(result);
                }
            }
            catch (e) {
                console.error(e);
            }
            this.onSyncEnd();
            return tries;
        });
    }
    backup() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.$$localPersistence) {
                throw new Error("Local persistence not available");
            }
            return JSON.stringify(yield this.$$localPersistence.dump());
        });
    }
    restoreBackup(input) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.$$remotePersistence) {
                yield this.$$remotePersistence.checkOnline();
                if (!this.$$remotePersistence.isOnline) {
                    throw new Error("Can not restore backup when the client is offline!");
                }
            }
            const dump = JSON.parse(input);
            if (!this.$$localPersistence) {
                throw new Error("Local persistence not available");
            }
            yield this.$$localPersistence.put(dump.data);
            yield this.$$localPersistence.putDeferred(dump.metadata.deferred);
            yield this.$$localPersistence.putVersion(dump.metadata.version);
            yield this.$$loadFromLocal();
            if (this.$$remotePersistence) {
                yield this.$$remotePersistence.put(dump.data);
                return yield this.sync(); // to get latest version number
            }
            return [];
        });
    }
    /**
     * Public methods, to be used by the application
     */
    /**
     * List of all items in the store (excluding deleted items)
     */
    get list() {
        return this.$$observableObject.target.filter((x) => !x.$$deleted);
    }
    /**
     * List of all items in the store (including deleted items) However, the list is not observable
     */
    get copy() {
        return this.$$observableObject.copy;
    }
    getByID(id) {
        return this.$$observableObject.target.find((x) => x.id === id);
    }
    add(item) {
        if (this.$$observableObject.target.find((x) => x.id === item.id)) {
            throw new Error("Duplicate ID detected: " + JSON.stringify(item.id));
        }
        this.$$observableObject.target.push(item);
    }
    restoreItem(id) {
        const item = this.$$observableObject.target.find((x) => x.id === id);
        if (!item) {
            throw new Error("Item not found.");
        }
        delete item.$$deleted;
    }
    delete(item) {
        const index = this.$$observableObject.target.findIndex((x) => x.id === item.id);
        if (index === -1) {
            throw new Error("Item not found.");
        }
        this.deleteByIndex(index);
    }
    deleteByIndex(index) {
        if (!this.$$observableObject.target[index]) {
            throw new Error("Item not found.");
        }
        this.$$observableObject.target[index].$$deleted = true;
    }
    deleteByID(id) {
        const index = this.$$observableObject.target.findIndex((x) => x.id === id);
        if (index === -1) {
            throw new Error("Item not found.");
        }
        this.deleteByIndex(index);
    }
    updateByIndex(index, item) {
        if (!this.$$observableObject.target[index]) {
            throw new Error("Item not found.");
        }
        if (this.$$observableObject.target[index].id !== item.id) {
            throw new Error("ID mismatch.");
        }
        this.$$observableObject.target[index] = item;
    }
    updateByID(id, item) {
        const index = this.$$observableObject.target.findIndex((x) => x.id === id);
        if (index === -1) {
            throw new Error("Item not found.");
        }
        if (this.$$observableObject.target[index].id !== item.id) {
            throw new Error("ID mismatch.");
        }
        this.updateByIndex(index, item);
    }
    isUpdated() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.$$localPersistence && this.$$remotePersistence) {
                return ((yield this.$$localPersistence.getVersion()) ===
                    (yield this.$$remotePersistence.getVersion()));
            }
            else
                return false;
        });
    }
    get loaded() {
        return new Promise((resolve) => {
            let i = setInterval(() => {
                if (this.$$loaded) {
                    clearInterval(i);
                    resolve();
                }
            }, 100);
        });
    }
    get isOnline() {
        if (!this.$$remotePersistence)
            return false;
        return this.$$remotePersistence.isOnline;
    }
}
