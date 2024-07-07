/**
 * Creating an an observable array
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
export { observable, isObservable, Change };
