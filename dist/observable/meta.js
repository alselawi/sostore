import { proxiedArrayMethods } from "./arr";
import { Change } from "./change";
import { oMetaKey, DELETE, INSERT, UPDATE } from "./const";
import { prepare } from "./prepare";
import * as utils from "./utils";
export class ObservableMeta {
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
                    new Change(INSERT, [key], newValue, undefined, this.proxy, utils.copy(this.proxy)),
                ]
                : [
                    new Change(UPDATE, [key], newValue, oldValue, this.proxy, utils.copy(this.proxy)),
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
            new Change(DELETE, [key], undefined, oldValue, this.proxy, utils.copy(this.proxy)),
        ];
        this.callObservers(changes);
        return true;
    }
    QueMicroTask(observableMeta) {
        let skip = false;
        if (utils.findGrandParent(this).runningSilentWork)
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
                    changes[j] = new Change(change.type, [currentObservable.ownKey, ...change.path], change.value, change.oldValue, change.object, utils.copy(utils.findGrandParent(currentObservable).proxy));
                }
                currentObservable = parent;
            }
            else {
                currentObservable = null;
            }
        } while (currentObservable);
    }
}
export class ObservableObjectMeta extends ObservableMeta {
    constructor(properties) {
        super(properties, prepare.object);
    }
    get(target, key, receiver) {
        if (utils.isSpecialObj(target)) {
            const value = Reflect.get(target, key, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        }
        return target[key];
    }
}
export class ObservableArrayMeta extends ObservableMeta {
    constructor(properties) {
        super(properties, prepare.array);
    }
    get(target, key) {
        return proxiedArrayMethods[key] || target[key];
    }
}
