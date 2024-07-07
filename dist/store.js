var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { observable } from "./observable";
import { IDB } from "./idb";
import { SyncService } from "./sync-service";
import { debounce } from "./debounce";
import { Document } from "./model";
export class Store {
    constructor({ name, token, persist = true, endpoint, debounceRate, model, encode, decode, }) {
        this.isOnline = true;
        this.deferredPresent = false;
        this.$$observableObject = observable([]);
        this.$$changes = [];
        this.$$syncService = null;
        this.$$debounceRate = 100;
        this.$$lastProcessChanges = 0;
        this.$$encode = (x) => x;
        this.$$decode = (x) => x;
        this.sync = debounce(this.$$sync.bind(this), this.$$debounceRate);
        this.$$model = model || Document;
        if (encode) {
            this.$$encode = encode;
        }
        if (decode) {
            this.$$decode = decode;
        }
        if (typeof debounceRate === "number") {
            this.$$debounceRate = debounceRate;
        }
        if (name && persist) {
            this.$$idb = new IDB(name);
            this.$$loadFromLocal();
            this.$$setupObservers();
        }
        if (token && endpoint && name && persist) {
            this.$$token = token;
            this.$$syncService = new SyncService(endpoint, this.$$token, name);
        }
    }
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
    $$deserialize(line) {
        line = this.$$decode(line);
        const item = JSON.parse(line, function (key, val) {
            if (key === "$$date")
                return new Date(val);
            let t = typeof val;
            if (t === "string" || t === "number" || t === "boolean" || val === null)
                return val;
            if (val && val.$$date)
                return val.$$date;
            return val;
        });
        return this.$$model.new(item);
    }
    $$loadFromLocal() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.$$idb)
                return;
            const deserialized = (yield this.$$idb.values()).map((x) => this.$$deserialize(x));
            this.$$observableObject.silently((o) => {
                o.splice(0, o.length, ...deserialized);
            });
        });
    }
    $$processChanges() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.$$idb)
                return;
            this.$$lastProcessChanges = Date.now();
            const toWriteLocally = [];
            const toSendRemotely = {};
            const toDeffer = [];
            const changesToProcess = [...this.$$changes]; // Create a copy of changes to process
            this.$$changes = []; // Clear the original changes array
            for (let index = 0; index < changesToProcess.length; index++) {
                const change = changesToProcess[index];
                const item = change.snapshot[change.path[0]];
                const serializedLine = this.$$serialize(item);
                toWriteLocally.push([item.id, serializedLine]);
                toSendRemotely[item.id] = serializedLine;
                toDeffer.push({
                    ts: Date.now(),
                    data: serializedLine,
                });
            }
            yield this.$$idb.setBulk(toWriteLocally);
            const deferred = (yield this.$$idb.getMetadata("deferred")) || "[]";
            let deferredArray = JSON.parse(deferred);
            if (this.isOnline && this.$$syncService && deferredArray.length === 0) {
                try {
                    yield this.$$syncService.sendUpdates(toSendRemotely);
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
            deferredArray = deferredArray.concat(...toDeffer);
            yield this.$$idb.setMetadata("deferred", JSON.stringify(deferredArray));
            this.deferredPresent = true;
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
    $$localVersion() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.$$idb)
                return 0;
            return Number((yield this.$$idb.getMetadata("version")) || 0);
        });
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
            if (!this.$$idb) {
                return {
                    exception: "IDB not available",
                };
            }
            ;
            if (!this.$$syncService) {
                return {
                    exception: "Sync service not available",
                };
            }
            if (!this.isOnline) {
                return {
                    exception: "Offline",
                };
            }
            try {
                const localVersion = yield this.$$localVersion();
                const remoteVersion = yield this.$$syncService.latestVersion();
                const deferred = (yield this.$$idb.getMetadata("deferred")) || "[]";
                let deferredArray = JSON.parse(deferred);
                if (localVersion === remoteVersion && deferredArray.length === 0) {
                    return {
                        exception: "Nothing to sync",
                    };
                }
                // fetch updates since our local version
                const remoteUpdates = yield this.$$syncService.fetchData(localVersion);
                // check for conflicts
                deferredArray = deferredArray.filter((x) => {
                    let item = this.$$deserialize(x.data);
                    const conflict = remoteUpdates.rows.findIndex((y) => y.id === item.id);
                    if (conflict === -1) {
                        return true;
                    }
                    else if (x.ts > remoteVersion) {
                        // there's a conflict, but the local change is newer
                        remoteUpdates.rows.splice(conflict, 1);
                        return true;
                    }
                    else {
                        // there's a conflict, and the remote change is newer
                        return false;
                    }
                });
                // now we have local and remote to update
                // we should start with remote
                for (const remote of remoteUpdates.rows) {
                    yield this.$$idb.set(remote.id, remote.data);
                }
                // then local
                const updatedRows = {};
                for (const local of deferredArray) {
                    let item = this.$$deserialize(local.data);
                    updatedRows[item.id] = local.data;
                    // latest deferred write wins since it would overwrite the previous one
                }
                yield this.$$syncService.sendUpdates(updatedRows);
                // reset deferred
                yield this.$$idb.setMetadata("deferred", "[]");
                this.deferredPresent = false;
                // set local version
                yield this.$$idb.setMetadata("version", remoteUpdates.version.toString());
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
                return { pushed, pulled };
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
            let tries = [];
            let exceptionOccurred = false;
            while (!exceptionOccurred) {
                const result = yield this.$$syncTry();
                if (result.exception) {
                    exceptionOccurred = true;
                }
                tries.push(result);
            }
            return tries;
        });
    }
    /**
     * Public methods, to be used by the application
     */
    get list() {
        return this.$$observableObject.observable.filter((x) => !x.$$deleted);
    }
    getByID(id) {
        return this.$$observableObject.observable.find((x) => x.id === id);
    }
    add(item) {
        if (this.$$observableObject.observable.find((x) => x.id === item.id)) {
            throw new Error("Duplicate ID detected: " + JSON.stringify(item.id));
        }
        this.$$observableObject.observable.push(item);
    }
    delete(item) {
        const index = this.$$observableObject.observable.findIndex((x) => x.id === item.id);
        if (index === -1) {
            throw new Error("Item not found.");
        }
        this.deleteByIndex(index);
    }
    deleteByIndex(index) {
        if (!this.$$observableObject.observable[index]) {
            throw new Error("Item not found.");
        }
        this.$$observableObject.observable[index].$$deleted = true;
    }
    deleteByID(id) {
        const index = this.$$observableObject.observable.findIndex((x) => x.id === id);
        if (index === -1) {
            throw new Error("Item not found.");
        }
        this.deleteByIndex(index);
    }
    updateByIndex(index, item) {
        if (!this.$$observableObject.observable[index]) {
            throw new Error("Item not found.");
        }
        if (this.$$observableObject.observable[index].id !== item.id) {
            throw new Error("ID mismatch.");
        }
        this.$$observableObject.observable[index] = item;
    }
    isUpdated() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.$$syncService ? ((yield this.$$syncService.latestVersion()) === (yield this.$$localVersion())) : true;
        });
    }
}
