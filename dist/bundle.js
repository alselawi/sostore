(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.sostore = {}));
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

    // polyfill
    (function (global) {
        if (typeof global.queueMicrotask !== "function") {
            global.queueMicrotask = function (callback) {
                Promise.resolve().then(callback);
            };
        }
    })(typeof global !== "undefined"
        ? global
        : typeof window !== "undefined"
            ? window
            : undefined);
    function findGrandParent(observable, visited = new Set()) {
        if (visited.has(observable)) {
            throw new Error("Circular reference detected in observable structure");
        }
        visited.add(observable);
        if (observable.parent)
            return findGrandParent(observable.parent, visited);
        else
            return observable;
    }
    function copy(obj) {
        if (obj === null || typeof obj !== "object") {
            return obj;
        }
        if (obj instanceof Date) {
            return new Date(obj.getTime());
        }
        if (Array.isArray(obj)) {
            const arrCopy = [];
            for (const item of obj) {
                arrCopy.push(copy(item));
            }
            return arrCopy;
        }
        const objCopy = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                objCopy[key] = copy(obj[key]);
            }
        }
        return objCopy;
    }
    function copyPropertiesTo(source, target) {
        const prototype = Object.getPrototypeOf(source);
        const propertyNames = [
            ...Object.getOwnPropertyNames(source),
            ...Object.getOwnPropertyNames(prototype),
        ];
        propertyNames.forEach((name) => {
            if (name !== "constructor") {
                const descriptor = Object.getOwnPropertyDescriptor(source, name) ||
                    Object.getOwnPropertyDescriptor(prototype, name);
                const isMethod = typeof (descriptor === null || descriptor === void 0 ? void 0 : descriptor.value) === "function";
                const hasGetter = typeof (descriptor === null || descriptor === void 0 ? void 0 : descriptor.get) === "function";
                const hasSetter = typeof (descriptor === null || descriptor === void 0 ? void 0 : descriptor.set) === "function";
                if (descriptor && (isMethod || hasGetter || hasSetter)) {
                    Object.defineProperty(target, name, descriptor);
                }
            }
        });
    }
    function isSpecialObj(input) {
        if (input instanceof RegExp ||
            input instanceof Map ||
            input instanceof Set ||
            input instanceof WeakMap ||
            input instanceof WeakSet ||
            input instanceof Promise ||
            input instanceof Date ||
            input instanceof Error)
            return true;
        return false;
    }

    /**
     * Constants
     */
    const INSERT = "insert";
    const UPDATE = "update";
    const DELETE = "delete";
    const REVERSE = "reverse";
    const SHUFFLE = "shuffle";
    const oMetaKey = Symbol.for("object-observer-meta-key-0");

    /**
     * Change class:
     * any change that would be sent to the observer will contain this class properties
     */
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

    const prepare = {
        object(source, oMeta, visited) {
            let target = {};
            if (isSpecialObj(source)) {
                target = source;
            }
            else {
                // for regular objects copy and go deeper
                for (const key in source) {
                    target[key] = prepare.getObservedOf(source[key], key, oMeta, visited);
                }
            }
            target[oMetaKey] = oMeta;
            // also copy methods, getters and setters
            copyPropertiesTo(source, target);
            return target;
        },
        array(source, oMeta, visited) {
            let l = source.length;
            const target = new Array(l);
            target[oMetaKey] = oMeta;
            for (let i = 0; i < l; i++) {
                target[i] = prepare.getObservedOf(source[i], i, oMeta, visited);
            }
            return target;
        },
        getObservedOf(item, key, parent, visited) {
            if (visited !== undefined && visited.has(item)) {
                return null;
            }
            else if (typeof item !== "object" || item === null) {
                return item;
            }
            else if (Array.isArray(item)) {
                return new ObservableArrayMeta({
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
                return new ObservableObjectMeta({
                    target: item,
                    ownKey: key,
                    parent: parent,
                    visited,
                }).proxy;
            }
        },
    };

    /***
     * Proxied Array methods
     */
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
        oMeta.callObservers(changes);
        return popResult;
    }
    function proxiedPush() {
        const oMeta = this[oMetaKey], target = oMeta.target, l = arguments.length, pushContent = new Array(l), initialLength = target.length;
        for (let i = 0; i < l; i++) {
            pushContent[i] = prepare.getObservedOf(arguments[i], initialLength + i, oMeta);
        }
        const pushResult = Reflect.apply(target.push, target, pushContent);
        const changes = [];
        for (let i = initialLength, j = target.length; i < j; i++) {
            changes[i - initialLength] = new Change(INSERT, [i], target[i], undefined, this, copy(this));
        }
        oMeta.callObservers(changes);
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
        oMeta.callObservers(changes);
        return shiftResult;
    }
    function proxiedUnshift() {
        const oMeta = this[oMetaKey], target = oMeta.target, al = arguments.length, unshiftContent = new Array(al);
        for (let i = 0; i < al; i++) {
            unshiftContent[i] = prepare.getObservedOf(arguments[i], i, oMeta);
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
        oMeta.callObservers(changes);
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
        oMeta.callObservers(changes);
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
        oMeta.callObservers(changes);
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
                target[i] = prepare.getObservedOf(item, i, oMeta);
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
            oMeta.callObservers(changes);
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
                    nItem = prepare.getObservedOf(nItem, i, oMeta);
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
            oMeta.callObservers(changes);
        }
        return this;
    }
    function proxiedSplice() {
        const oMeta = this[oMetaKey], target = oMeta.target, splLen = arguments.length, spliceContent = new Array(splLen), tarLen = target.length;
        //	make newcomers observable
        for (let i = 0; i < splLen; i++) {
            spliceContent[i] = prepare.getObservedOf(arguments[i], i, oMeta);
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
        oMeta.callObservers(changes);
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

    class ObservableMeta {
        constructor(properties, cloningFunction) {
            this.observers = [];
            this.batches = [];
            this.runningSilentWork = false;
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
                const newValue = prepare.getObservedOf(value, key, this);
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
                this.callObservers(changes);
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
            this.callObservers(changes);
            return true;
        }
        QueMicroTask(observableMeta) {
            let skip = false;
            if (findGrandParent(this).runningSilentWork)
                skip = true;
            queueMicrotask(() => {
                const batches = observableMeta.batches;
                observableMeta.batches = [];
                for (const [listener, changes] of batches) {
                    try {
                        if (skip)
                            break;
                        listener(changes);
                    }
                    catch (e) {
                        console.error(`Failed to notify listener ${listener} with ${changes}:`, e);
                    }
                }
            });
        }
        callObservers(changes) {
            let currentObservable = this;
            const l = changes.length;
            do {
                let observers = currentObservable.observers;
                let i = observers.length;
                while (i--) {
                    let target = observers[i];
                    if (changes.length) {
                        if (currentObservable.batches.length === 0) {
                            this.QueMicroTask(currentObservable);
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
    }
    class ObservableObjectMeta extends ObservableMeta {
        constructor(properties) {
            super(properties, prepare.object);
        }
        get(target, key, receiver) {
            if (isSpecialObj(target)) {
                const value = Reflect.get(target, key, receiver);
                return typeof value === "function" ? value.bind(target) : value;
            }
            return target[key];
        }
    }
    class ObservableArrayMeta extends ObservableMeta {
        constructor(properties) {
            super(properties, prepare.array);
        }
        get(target, key) {
            return proxiedArrayMethods[key] || target[key];
        }
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

    const observingComponents = {};
    /**
     * Enhances a React component to automatically re-render when the observed store changes.
     * @param store - An instance of Store that extends Document.
     * @returns A higher-order function that takes a React component as an argument.
     */
    function observe(component) {
        const oComponentDidMount = component.prototype.componentDidMount || (() => { });
        component.prototype.componentDidMount = function () {
            this.setState({});
            this.$$observerID = uuid();
            observingComponents[this.$$observerID] = () => this.setState({});
            const oComponentWillUnmount = this.componentWillUnmount || (() => { });
            this.componentWillUnmount = () => {
                delete observingComponents[this.$$observerID];
                oComponentWillUnmount.call(this);
            };
            oComponentDidMount.call(this);
        };
        return component;
    }

    class Observable {
        constructor(argument) {
            /**
             * An array of the all the observers registered to this observable
             */
            this.observers = [];
            this.target = Observable.isObservable(argument)
                ? argument
                : Array.isArray(argument)
                    ? new ObservableArrayMeta({
                        target: argument,
                        ownKey: "",
                        parent: null,
                    }).proxy
                    : new ObservableObjectMeta({
                        target: argument,
                        ownKey: "",
                        parent: null,
                    }).proxy;
            this.observers = this.target[oMetaKey].observers;
            this.observe(() => {
                Object.keys(observingComponents).forEach((key) => observingComponents[key]());
            });
        }
        /**
         *
         * Remove an observer from the list of observers
         * can be given a single observer
         * an array of observers
         * or no argument to remove all observers
         */
        unobserve(observers) {
            if (!observers)
                return this.__unobserve();
            else if (Array.isArray(observers))
                return this.__unobserve(observers);
            else
                return this.__unobserve([observers]);
        }
        /**
         * Register a new observer
         */
        observe(observer) {
            this.__observe(observer);
        }
        /**
         * Execute a callback silently (without calling the observers)
         */
        silently(work) {
            this.target[oMetaKey].runningSilentWork = true;
            try {
                work(this.target);
            }
            finally {
                this.target[oMetaKey].runningSilentWork = false;
            }
        }
        /**
         * Get a non-observed copy of the observable array
         * changes to this copy wouldn't be replicated to the observable array
         * and wouldn't cause observers to be called
         */
        get copy() {
            return copy(this.target);
        }
        __observe(observer) {
            const observers = this.target[oMetaKey].observers;
            if (!observers.some((o) => o === observer)) {
                observers.push(observer);
            }
        }
        __unobserve(observers) {
            const existingObs = this.target[oMetaKey].observers;
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
        }
        /**
         * when given any input it would return:
         * true: if it's an observable object (even if deeply nested inside observable array)
         * false: if not
         */
        static isObservable(input) {
            return !!(input && input[oMetaKey]);
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
            /**
             * Synchronize local with remote database
             */
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
        // ----------------------------- PUBLIC API -----------------------------
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
        /**
         * Fetch document by ID
         */
        get(id) {
            return this.$$observableObject.target.find((x) => x.id === id);
        }
        /**
         * Add document (will model it as well)
         */
        add(item) {
            if (this.$$observableObject.target.find((x) => x.id === item.id)) {
                throw new Error("Duplicate ID detected: " + JSON.stringify(item.id));
            }
            let modeledItem = this.$$model.new(item);
            this.$$observableObject.target.push(modeledItem);
        }
        /**
         * Restore item after deletion
         */
        restoreItem(id) {
            const item = this.$$observableObject.target.find((x) => x.id === id);
            if (!item) {
                throw new Error("Item not found.");
            }
            delete item.$$deleted;
        }
        /**
         * delete Item (by ID)
         */
        delete(id) {
            const index = this.$$observableObject.target.findIndex((x) => x.id === id);
            if (index === -1) {
                throw new Error("Item not found.");
            }
            this.$$observableObject.target[index].$$deleted = true;
        }
        /**
         * Update item properties (by ID)
         */
        update(id, item) {
            const index = this.$$observableObject.target.findIndex((x) => x.id === id);
            if (index === -1) {
                throw new Error("Item not found.");
            }
            if (this.$$observableObject.target[index].id !== item.id) {
                throw new Error("ID mismatch.");
            }
            Object.keys(item).forEach((key) => {
                this.$$observableObject.target[index][key] =
                    item[key];
            });
        }
        /**
         * whether the local database is in sync with the remote database
         */
        inSync() {
            return __awaiter(this, void 0, void 0, function* () {
                if (this.$$localPersistence && this.$$remotePersistence) {
                    return ((yield this.$$localPersistence.getVersion()) ===
                        (yield this.$$remotePersistence.getVersion()));
                }
                else
                    return false;
            });
        }
        /**
         * whether the local database has fully loaded
         */
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
        /**
         * Whether the remote database is currently online
         */
        get isOnline() {
            if (!this.$$remotePersistence)
                return false;
            return this.$$remotePersistence.isOnline;
        }
        /**
         * Backup the local store, returns a string that can be used to restore the backup
         */
        backup() {
            return __awaiter(this, void 0, void 0, function* () {
                if (!this.$$localPersistence) {
                    throw new Error("Local persistence not available");
                }
                return JSON.stringify(yield this.$$localPersistence.dump());
            });
        }
        /**
         * Restore the local store from a backup
         * @param input the backup string
         */
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
    }

    class IDB {
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
        getOne(id) {
            return this.store("readonly", (store) => this.pr(store.get(id)));
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
        dump() {
            return this.store("readonly", (store) => __awaiter(this, void 0, void 0, function* () {
                let data = [];
                if (store.getAll && store.getAllKeys) {
                    const keys = yield this.pr(store.getAllKeys());
                    const values = yield this.pr(store.getAll());
                    data = keys.map((key, index) => [key, values[index]]);
                }
                else {
                    yield this.eachCursor(store, (cursor) => {
                        data.push([cursor.key, cursor.value]);
                    });
                }
                return {
                    data,
                    metadata: {
                        version: yield this.getVersion(),
                        deferred: yield this.getDeferred(),
                    },
                };
            }));
        }
    }

    class CloudFlareApexoDB {
        constructor({ endpoint, token, name, }) {
            this.isOnline = true;
            this.baseUrl = endpoint;
            this.token = token;
            this.table = name;
            this.checkOnline();
        }
        checkOnline() {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    yield fetch(this.baseUrl, {
                        method: "HEAD",
                    });
                    this.isOnline = true;
                }
                catch (e) {
                    this.isOnline = false;
                    this.retryConnection();
                }
            });
        }
        retryConnection() {
            let i = setInterval(() => {
                if (this.isOnline)
                    clearInterval(i);
                else
                    this.checkOnline();
            }, 5000);
        }
        getSince() {
            return __awaiter(this, arguments, void 0, function* (version = 0) {
                let page = 0;
                let nextPage = true;
                let fetchedVersion = 0;
                let result = [];
                while (nextPage) {
                    const url = `${this.baseUrl}/${this.table}/${version}/${page}`;
                    let res;
                    try {
                        const response = yield fetch(url, {
                            method: "GET",
                            headers: {
                                Authorization: `Bearer ${this.token}`,
                            },
                        });
                        res = yield response.json();
                    }
                    catch (e) {
                        this.checkOnline();
                        res = {
                            success: false,
                            output: ``,
                        };
                        break;
                    }
                    if (res.success === false) {
                        result = [];
                        version = 0;
                        break;
                    }
                    const output = JSON.parse(res.output);
                    nextPage = output.rows.length > 0 && version !== 0;
                    fetchedVersion = output.version;
                    result = result.concat(output.rows);
                    page = page + 1;
                }
                return { version: fetchedVersion, rows: result };
            });
        }
        getVersion() {
            return __awaiter(this, void 0, void 0, function* () {
                const url = `${this.baseUrl}/${this.table}/0/Infinity`;
                let res;
                try {
                    const response = yield fetch(url, {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${this.token}`,
                        },
                    });
                    res = yield response.json();
                }
                catch (e) {
                    this.checkOnline();
                    res = {
                        success: false,
                        output: ``,
                    };
                }
                if (res.success)
                    return Number(JSON.parse(res.output).version);
                else
                    return 0;
            });
        }
        put(data) {
            return __awaiter(this, void 0, void 0, function* () {
                const reqBody = data.reduce((record, item) => {
                    record[item[0]] = item[1];
                    return record;
                }, {});
                const url = `${this.baseUrl}/${this.table}`;
                try {
                    yield fetch(url, {
                        method: "PUT",
                        headers: {
                            Authorization: `Bearer ${this.token}`,
                        },
                        body: JSON.stringify(reqBody),
                    });
                }
                catch (e) {
                    this.checkOnline();
                    throw e;
                }
                return;
            });
        }
    }

    exports.CloudFlareApexoDB = CloudFlareApexoDB;
    exports.Document = Document;
    exports.IDB = IDB;
    exports.Observable = Observable;
    exports.Store = Store;
    exports.SubDocument = SubDocument;
    exports.mapSubModel = mapSubModel;
    exports.observe = observe;

}));
