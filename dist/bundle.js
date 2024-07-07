(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.apicalStore = {}));
})(this, (function (exports) { 'use strict';

    /******************************************************************************
    Copyright (c) Microsoft Corporation.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
    PERFORMANCE OF THIS SOFTWARE.
    ***************************************************************************** */
    /* global Reflect, Promise, SuppressedError, Symbol */


    function __awaiter(thisArg, _arguments, P, generator) {
        function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
        return new (P || (P = Promise))(function (resolve, reject) {
            function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
            function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
            function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
            step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
    }

    typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
        var e = new Error(message);
        return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
    };

    /**
     * Creating an an observable array
     */
    const INSERT = "insert";
    const UPDATE = "update";
    const DELETE = "delete";
    const REVERSE = "reverse";
    const SHUFFLE = "shuffle";
    const oMetaKey = Symbol.for("object-observer-meta-key-0");
    function findGrandParent(observable) {
        if (observable.parent)
            return findGrandParent(observable.parent);
        else
            return observable;
    }
    function copy(v) {
        return JSON.parse(JSON.stringify({ tmp: v })).tmp;
    }
    function prepareObject(source, oMeta, visited) {
        const target = {};
        target[oMetaKey] = oMeta;
        for (const key in source) {
            target[key] = getObservedOf(source[key], key, oMeta, visited);
        }
        return target;
    }
    function prepareArray(source, oMeta, visited) {
        let l = source.length;
        const target = new Array(l);
        target[oMetaKey] = oMeta;
        for (let i = 0; i < l; i++) {
            target[i] = getObservedOf(source[i], i, oMeta, visited);
        }
        return target;
    }
    function callObserverSafe(listener, changes) {
        try {
            listener(changes);
        }
        catch (e) {
            console.error(`Failed to notify listener ${listener} with ${changes}`, e);
        }
    }
    function callObserversFromMT() {
        const batches = this.batches;
        this.batches = [];
        for (const [listener, changes] of batches) {
            callObserverSafe(listener, changes);
        }
    }
    function callObservers(oMeta, changes) {
        let currentObservable = oMeta;
        const l = changes.length;
        do {
            let observers = currentObservable.observers;
            let i = observers.length;
            while (i--) {
                let target = observers[i];
                if (changes.length) {
                    if (currentObservable.batches.length === 0) {
                        // @ts-ignore
                        queueMicrotask(callObserversFromMT.bind(currentObservable));
                    }
                    let rb;
                    for (const batch of currentObservable.batches) {
                        if (batch[0] === target) {
                            rb = batch;
                            break;
                        }
                    }
                    if (!rb) {
                        rb = [target, []];
                        currentObservable.batches.push(rb);
                    }
                    Array.prototype.push.apply(rb[1], changes);
                }
            }
            //	cloning all the changes and notifying in context of parent
            const parent = currentObservable.parent;
            if (parent) {
                for (let j = 0; j < l; j++) {
                    const change = changes[j];
                    changes[j] = new Change(change.type, [currentObservable.ownKey, ...change.path], change.value, change.oldValue, change.object, copy(findGrandParent(currentObservable).proxy));
                }
                currentObservable = parent;
            }
            else {
                currentObservable = null;
            }
        } while (currentObservable);
    }
    function getObservedOf(item, key, parent, visited) {
        if (visited !== undefined && visited.has(item)) {
            return null;
        }
        else if (typeof item !== "object" || item === null) {
            return item;
        }
        else if (Array.isArray(item)) {
            return new ArrayOMeta({
                target: item,
                ownKey: key,
                parent: parent,
                visited,
            }).proxy;
        }
        else if (item instanceof Date) {
            return item;
        }
        else {
            return new ObjectOMeta({
                target: item,
                ownKey: key,
                parent: parent,
                visited,
            }).proxy;
        }
    }
    function proxiedPop() {
        const oMeta = this[oMetaKey], target = oMeta.target, poppedIndex = target.length - 1;
        let popResult = target.pop();
        if (popResult && typeof popResult === "object") {
            const tmpObserved = popResult[oMetaKey];
            if (tmpObserved) {
                popResult = tmpObserved.detach();
            }
        }
        const changes = [
            new Change(DELETE, [poppedIndex], undefined, popResult, this, copy(this)),
        ];
        callObservers(oMeta, changes);
        return popResult;
    }
    function proxiedPush() {
        const oMeta = this[oMetaKey], target = oMeta.target, l = arguments.length, pushContent = new Array(l), initialLength = target.length;
        for (let i = 0; i < l; i++) {
            pushContent[i] = getObservedOf(arguments[i], initialLength + i, oMeta);
        }
        const pushResult = Reflect.apply(target.push, target, pushContent);
        const changes = [];
        for (let i = initialLength, j = target.length; i < j; i++) {
            changes[i - initialLength] = new Change(INSERT, [i], target[i], undefined, this, copy(this));
        }
        callObservers(oMeta, changes);
        return pushResult;
    }
    function proxiedShift() {
        const oMeta = this[oMetaKey], target = oMeta.target;
        let shiftResult, i, l, item, tmpObserved;
        shiftResult = target.shift();
        if (shiftResult && typeof shiftResult === "object") {
            tmpObserved = shiftResult[oMetaKey];
            if (tmpObserved) {
                shiftResult = tmpObserved.detach();
            }
        }
        //	update indices of the remaining items
        for (i = 0, l = target.length; i < l; i++) {
            item = target[i];
            if (item && typeof item === "object") {
                tmpObserved = item[oMetaKey];
                if (tmpObserved) {
                    tmpObserved.ownKey = i;
                }
            }
        }
        const changes = [
            new Change(DELETE, [0], undefined, shiftResult, this, copy(this)),
        ];
        callObservers(oMeta, changes);
        return shiftResult;
    }
    function proxiedUnshift() {
        const oMeta = this[oMetaKey], target = oMeta.target, al = arguments.length, unshiftContent = new Array(al);
        for (let i = 0; i < al; i++) {
            unshiftContent[i] = getObservedOf(arguments[i], i, oMeta);
        }
        const unshiftResult = Reflect.apply(target.unshift, target, unshiftContent);
        for (let i = 0, l = target.length, item; i < l; i++) {
            item = target[i];
            if (item && typeof item === "object") {
                const tmpObserved = item[oMetaKey];
                if (tmpObserved) {
                    tmpObserved.ownKey = i;
                }
            }
        }
        //	publish changes
        const l = unshiftContent.length;
        const changes = new Array(l);
        for (let i = 0; i < l; i++) {
            changes[i] = new Change(INSERT, [i], target[i], undefined, this, copy(this));
        }
        callObservers(oMeta, changes);
        return unshiftResult;
    }
    function proxiedReverse() {
        const oMeta = this[oMetaKey], target = oMeta.target;
        let i, l, item;
        target.reverse();
        for (i = 0, l = target.length; i < l; i++) {
            item = target[i];
            if (item && typeof item === "object") {
                const tmpObserved = item[oMetaKey];
                if (tmpObserved) {
                    tmpObserved.ownKey = i;
                }
            }
        }
        const changes = [
            new Change(REVERSE, [], undefined, undefined, this, copy(this)),
        ];
        callObservers(oMeta, changes);
        return this;
    }
    function proxiedSort(comparator) {
        const oMeta = this[oMetaKey], target = oMeta.target;
        let i, l, item;
        target.sort(comparator);
        for (i = 0, l = target.length; i < l; i++) {
            item = target[i];
            if (item && typeof item === "object") {
                const tmpObserved = item[oMetaKey];
                if (tmpObserved) {
                    tmpObserved.ownKey = i;
                }
            }
        }
        const changes = [
            new Change(SHUFFLE, [], undefined, undefined, this, copy(this)),
        ];
        callObservers(oMeta, changes);
        return this;
    }
    function proxiedFill(filVal, start, end) {
        const oMeta = this[oMetaKey], target = oMeta.target, changes = [], tarLen = target.length, prev = target.slice(0);
        start =
            start === undefined
                ? 0
                : start < 0
                    ? Math.max(tarLen + start, 0)
                    : Math.min(start, tarLen);
        end =
            end === undefined
                ? tarLen
                : end < 0
                    ? Math.max(tarLen + end, 0)
                    : Math.min(end, tarLen);
        if (start < tarLen && end > start) {
            target.fill(filVal, start, end);
            let tmpObserved;
            for (let i = start, item, tmpTarget; i < end; i++) {
                item = target[i];
                target[i] = getObservedOf(item, i, oMeta);
                if (i in prev) {
                    tmpTarget = prev[i];
                    if (tmpTarget && typeof tmpTarget === "object") {
                        tmpObserved = tmpTarget[oMetaKey];
                        if (tmpObserved) {
                            tmpTarget = tmpObserved.detach();
                        }
                    }
                    changes.push(new Change(UPDATE, [i], target[i], tmpTarget, this, copy(this)));
                }
                else {
                    changes.push(new Change(INSERT, [i], target[i], undefined, this, copy(this)));
                }
            }
            callObservers(oMeta, changes);
        }
        return this;
    }
    function proxiedCopyWithin(dest, start, end) {
        const oMeta = this[oMetaKey], target = oMeta.target, tarLen = target.length;
        dest = dest < 0 ? Math.max(tarLen + dest, 0) : dest;
        start =
            start === undefined
                ? 0
                : start < 0
                    ? Math.max(tarLen + start, 0)
                    : Math.min(start, tarLen);
        end =
            end === undefined
                ? tarLen
                : end < 0
                    ? Math.max(tarLen + end, 0)
                    : Math.min(end, tarLen);
        const len = Math.min(end - start, tarLen - dest);
        if (dest < tarLen && dest !== start && len > 0) {
            const prev = target.slice(0), changes = [];
            target.copyWithin(dest, start, end);
            for (let i = dest, nItem, oItem, tmpObserved; i < dest + len; i++) {
                //	update newly placed observables, if any
                nItem = target[i];
                if (nItem && typeof nItem === "object") {
                    nItem = getObservedOf(nItem, i, oMeta);
                    target[i] = nItem;
                }
                //	detach overridden observables, if any
                oItem = prev[i];
                if (oItem && typeof oItem === "object") {
                    tmpObserved = oItem[oMetaKey];
                    if (tmpObserved) {
                        oItem = tmpObserved.detach();
                    }
                }
                if (typeof nItem !== "object" && nItem === oItem) {
                    continue;
                }
                changes.push(new Change(UPDATE, [i], nItem, oItem, this, copy(this)));
            }
            callObservers(oMeta, changes);
        }
        return this;
    }
    function proxiedSplice() {
        const oMeta = this[oMetaKey], target = oMeta.target, splLen = arguments.length, spliceContent = new Array(splLen), tarLen = target.length;
        //	make newcomers observable
        for (let i = 0; i < splLen; i++) {
            spliceContent[i] = getObservedOf(arguments[i], i, oMeta);
        }
        //	calculate pointers
        const startIndex = splLen === 0
            ? 0
            : spliceContent[0] < 0
                ? tarLen + spliceContent[0]
                : spliceContent[0], removed = splLen < 2 ? tarLen - startIndex : spliceContent[1], inserted = Math.max(splLen - 2, 0), spliceResult = Reflect.apply(target.splice, target, spliceContent), newTarLen = target.length;
        //	re-index the paths
        let tmpObserved;
        for (let i = 0, item; i < newTarLen; i++) {
            item = target[i];
            if (item && typeof item === "object") {
                tmpObserved = item[oMetaKey];
                if (tmpObserved) {
                    tmpObserved.ownKey = i;
                }
            }
        }
        //	detach removed objects
        let i, l, item;
        for (i = 0, l = spliceResult.length; i < l; i++) {
            item = spliceResult[i];
            if (item && typeof item === "object") {
                tmpObserved = item[oMetaKey];
                if (tmpObserved) {
                    spliceResult[i] = tmpObserved.detach();
                }
            }
        }
        const changes = [];
        let index;
        for (index = 0; index < removed; index++) {
            if (index < inserted) {
                changes.push(new Change(UPDATE, [startIndex + index], target[startIndex + index], spliceResult[index], this, copy(this)));
            }
            else {
                changes.push(new Change(DELETE, [startIndex + index], undefined, spliceResult[index], this, copy(this)));
            }
        }
        for (; index < inserted; index++) {
            changes.push(new Change(INSERT, [startIndex + index], target[startIndex + index], undefined, this, copy(this)));
        }
        callObservers(oMeta, changes);
        return spliceResult;
    }
    const proxiedArrayMethods = {
        pop: proxiedPop,
        push: proxiedPush,
        shift: proxiedShift,
        unshift: proxiedUnshift,
        reverse: proxiedReverse,
        sort: proxiedSort,
        fill: proxiedFill,
        copyWithin: proxiedCopyWithin,
        splice: proxiedSplice,
    };
    class Change {
        constructor(type, path, value, oldValue, object, snapshot) {
            this.type = type;
            this.path = path;
            this.value = copy(value);
            this.oldValue = copy(oldValue);
            this.object = object;
            this.snapshot = snapshot;
        }
    }
    class OMetaBase {
        constructor(properties, cloningFunction) {
            this.observers = [];
            this.batches = [];
            const { target, parent, ownKey, visited = new Set() } = properties;
            if (parent && ownKey !== undefined) {
                this.parent = parent;
                this.ownKey = ownKey;
            }
            else {
                this.parent = null;
                this.ownKey = "";
            }
            visited.add(target);
            const targetClone = cloningFunction(target, this, visited);
            visited.delete(target);
            this.revocable = Proxy.revocable(targetClone, this);
            this.proxy = this.revocable.proxy;
            this.target = targetClone;
            this.batches = [];
        }
        detach() {
            this.parent = null;
            return this.target;
        }
        set(target, key, value) {
            let oldValue = target[key];
            if (value !== oldValue) {
                const newValue = getObservedOf(value, key, this);
                target[key] = newValue;
                if (oldValue && typeof oldValue === "object") {
                    const tmpObserved = oldValue[oMetaKey];
                    if (tmpObserved) {
                        oldValue = tmpObserved.detach();
                    }
                }
                const changes = oldValue === undefined
                    ? [
                        new Change(INSERT, [key], newValue, undefined, this.proxy, copy(this.proxy)),
                    ]
                    : [
                        new Change(UPDATE, [key], newValue, oldValue, this.proxy, copy(this.proxy)),
                    ];
                callObservers(this, changes);
            }
            return true;
        }
        deleteProperty(target, key) {
            let oldValue = target[key];
            delete target[key];
            if (oldValue && typeof oldValue === "object") {
                const tmpObserved = oldValue[oMetaKey];
                if (tmpObserved) {
                    oldValue = tmpObserved.detach();
                }
            }
            const changes = [
                new Change(DELETE, [key], undefined, oldValue, this.proxy, copy(this.proxy)),
            ];
            callObservers(this, changes);
            return true;
        }
    }
    class ObjectOMeta extends OMetaBase {
        constructor(properties) {
            super(properties, prepareObject);
        }
    }
    class ArrayOMeta extends OMetaBase {
        constructor(properties) {
            super(properties, prepareArray);
        }
        get(target, key) {
            return proxiedArrayMethods[key] || target[key];
        }
    }
    function observable(target) {
        const o = isObservable(target)
            ? target
            : new ArrayOMeta({
                target: target,
                ownKey: "",
                parent: null,
            }).proxy;
        function unobserve(observers) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!observers)
                    return yield __unobserve(o);
                else if (Array.isArray(observers))
                    return yield __unobserve(o, observers);
                else
                    return yield __unobserve(o, [observers]);
            });
        }
        function observe(observer) {
            __observe(o, observer);
        }
        function silently(work) {
            return __awaiter(this, void 0, void 0, function* () {
                const observers = yield __unobserve(o);
                try {
                    work(o);
                }
                finally {
                    for (const observer of observers) {
                        __observe(o, observer);
                    }
                }
            });
        }
        return {
            observe,
            unobserve,
            silently,
            observable: o,
        };
    }
    function isObservable(input) {
        return !!(input && input[oMetaKey]);
    }
    function __observe(observable, observer) {
        const observers = observable[oMetaKey].observers;
        if (!observers.some((o) => o === observer)) {
            observers.push(observer);
        }
    }
    function __unobserve(observable, observers) {
        return __awaiter(this, void 0, void 0, function* () {
            if (observable instanceof Promise)
                observable = yield Promise.resolve(observable);
            const existingObs = observable[oMetaKey].observers;
            let length = existingObs.length;
            if (!length) {
                return [];
            }
            if (!observers) {
                return existingObs.splice(0);
            }
            let spliced = [];
            for (let index = 0; index < observers.length; index++) {
                const observer = observers[index];
                const i = existingObs.indexOf(observer);
                if (i > -1) {
                    spliced.push(existingObs.splice(i, 1)[0]);
                }
            }
            return spliced;
        });
    }

    class IDB {
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

    class SyncService {
        constructor(baseUrl, token, table) {
            this.baseUrl = baseUrl;
            this.token = token;
            this.table = table;
        }
        fetchData() {
            return __awaiter(this, arguments, void 0, function* (version = 0) {
                let page = 0;
                let nextPage = true;
                let fetchedVersion = 0;
                let result = [];
                while (nextPage) {
                    const url = `${this.baseUrl}/${this.table}/${version}/${page}`;
                    const response = yield fetch(url, {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${this.token}`,
                        },
                    });
                    const res = yield response.json();
                    const output = JSON.parse(res.output);
                    nextPage = output.rows.length > 0 && version !== 0;
                    fetchedVersion = output.version;
                    result = result.concat(output.rows);
                    page = page + 1;
                }
                return { version: fetchedVersion, rows: result };
            });
        }
        latestVersion() {
            return __awaiter(this, void 0, void 0, function* () {
                const url = `${this.baseUrl}/${this.table}/0/Infinity`;
                const response = yield fetch(url, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                    },
                });
                const res = yield response.json();
                if (res.success)
                    return Number(JSON.parse(res.output).version);
                else
                    return 0;
            });
        }
        sendUpdates(data) {
            return __awaiter(this, void 0, void 0, function* () {
                const url = `${this.baseUrl}/${this.table}`;
                const response = yield fetch(url, {
                    method: "PUT",
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                    },
                    body: JSON.stringify(data),
                });
                return Number((yield response.json()).output);
            });
        }
    }

    function debounce(func, wait) {
        let timeoutId = null;
        let lastPromise = null;
        return (...args) => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(() => {
                timeoutId = null;
            }, wait);
            if (lastPromise === null) {
                lastPromise = new Promise((resolve, reject) => {
                    timeoutId = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                        try {
                            const result = yield func(...args);
                            resolve(result);
                        }
                        catch (error) {
                            reject(error);
                        }
                        finally {
                            lastPromise = null;
                        }
                    }), wait);
                });
            }
            return lastPromise;
        };
    }

    const lut = [];
    for (let i = 0; i < 256; i++) {
        lut[i] = (i < 16 ? "0" : "") + i.toString(16);
    }
    function uuid() {
        let d0 = (Math.random() * 0xffffffff) | 0;
        let d1 = (Math.random() * 0xffffffff) | 0;
        let d2 = (Math.random() * 0xffffffff) | 0;
        let d3 = (Math.random() * 0xffffffff) | 0;
        return [
            lut[d0 & 0xff],
            lut[(d0 >> 8) & 0xff],
            lut[(d0 >> 16) & 0xff],
            lut[(d0 >> 24) & 0xff],
            '-',
            lut[d1 & 0xff],
            lut[(d1 >> 8) & 0xff],
            '-',
            lut[((d1 >> 16) & 0x0f) | 0x40],
            lut[(d1 >> 24) & 0xff],
            '-',
            lut[(d2 & 0x3f) | 0x80],
            lut[(d2 >> 8) & 0xff],
            '-',
            lut[(d2 >> 16) & 0xff],
            lut[(d2 >> 24) & 0xff],
            lut[d3 & 0xff],
            lut[(d3 >> 8) & 0xff],
            lut[(d3 >> 16) & 0xff],
            lut[(d3 >> 24) & 0xff]
        ].join('');
    }

    /**
     * Base model: of which all documents extend (Main documents & Sub-documents)
    */
    class BaseModel {
        /**
         * Use this method to create a new document before insertion/update into the observable store
         * This is where the actual mapping of pure JS object values get mapped into the model
         * It models the document and all of its sub-documents even if they are in an array
        */
        static new(data) {
            const instance = new this();
            if (typeof data !== "object" || data === null) {
                return instance;
            }
            const keys = Object.keys(Object.assign(Object.assign({}, instance), data));
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                let insVal = instance[key];
                let dataVal = data[key];
                if (insVal && insVal["_$SHOULD_MAP$_"]) {
                    if (dataVal === undefined) {
                        instance[key] = insVal["def"];
                    }
                    else if (Array.isArray(dataVal)) {
                        instance[key] = dataVal.map((x) => insVal.ctr.new(x));
                    }
                    else {
                        instance[key] = insVal.ctr.new(dataVal);
                    }
                }
                else {
                    instance[key] = dataVal === undefined ? insVal : dataVal;
                }
            }
            return instance;
        }
        /**
         * Strips default values from the model,
         * so it can be written to the persistence layer with the least amount of space
         * and it can be sent over the network with the least amount of size
        */
        _stripDefaults() {
            // maintain a cache of defaults
            if (!this.constructor._$def) {
                this.constructor._$def = this.constructor.new({});
            }
            let def = this.constructor._$def;
            const newData = {};
            for (const [key, oldV] of Object.entries(this)) {
                const defV = def[key];
                // handling arrays of sub-documents
                if (Array.isArray(oldV) && oldV[0] && oldV[0]._stripDefaults) {
                    newData[key] = oldV.map((sub) => sub._stripDefaults());
                    if (newData[key].length === 0)
                        delete newData[key]; // disregard empty arrays
                }
                // handling direct child sub-document
                else if (typeof oldV === "object" &&
                    oldV !== null &&
                    oldV._stripDefaults) {
                    newData[key] = oldV._stripDefaults();
                    if (Object.keys(newData[key]).length === 0)
                        delete newData[key]; // disregard empty objects
                }
                // handling non-sub-document values
                // we're converting to a string to eliminate non-primitive
                else if (JSON.stringify(defV) !== JSON.stringify(oldV))
                    newData[key] = oldV;
            }
            return newData;
        }
    }
    /**
     * Main document in the database extends this class:
     * A. Gets an ID automatically and a flag to mark it as deleted (soft delete)
     * D. gets Model.new() and model._stripDefaults() methods
    */
    class Document extends BaseModel {
        constructor() {
            super(...arguments);
            this.id = uuid();
        }
    }
    /**
     * Sub-documents extends this class:
     * gets Model.new() and model._stripDefaults() methods
    */
    class SubDocument extends BaseModel {
    }
    function mapSubModel(ctr, def) {
        return {
            _$SHOULD_MAP$_: true,
            def,
            ctr,
        };
    }

    class Store {
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

    function observe(store) {
        return function (component) {
            let oCDM = component.prototype.componentDidMount || (() => { });
            component.prototype.componentDidMount = function () {
                let unObservers = [];
                this.setState({});
                const observer = () => this.setState({});
                store.$$observableObject.observe(observer);
                unObservers.push(() => store.$$observableObject.unobserve(observer));
                const oCWU = this.componentWillUnmount || (() => { });
                this.componentWillUnmount = () => {
                    unObservers.forEach((u) => u());
                    oCWU.call(this);
                };
                oCDM.call(this);
            };
            return component;
        };
    }

    exports.Document = Document;
    exports.Store = Store;
    exports.SubDocument = SubDocument;
    exports.mapSubModel = mapSubModel;
    exports.observe = observe;

}));
