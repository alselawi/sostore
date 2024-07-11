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
        : this);
export function findGrandParent(observable) {
    if (observable.parent)
        return findGrandParent(observable.parent);
    else
        return observable;
}
export function copy(obj) {
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
