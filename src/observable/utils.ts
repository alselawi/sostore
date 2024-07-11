import { ObservableMeta } from "./meta";

// polyfill
(function (global: any) {
	if (typeof global.queueMicrotask !== "function") {
		global.queueMicrotask = function (callback: () => void) {
			Promise.resolve().then(callback);
		};
	}
})(
	typeof global !== "undefined"
		? global
		: typeof window !== "undefined"
		? window
		: this
);


export function findGrandParent<T extends object>(observable: ObservableMeta<T>): ObservableMeta<T> {
    if (observable.parent) return findGrandParent(observable.parent);
    else return observable;
}

export function copy<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") {
        return obj;
    }
    if (obj instanceof Date) {
        return new Date(obj.getTime()) as any;
    }
    if (Array.isArray(obj)) {
        const arrCopy = [] as any[];
        for (const item of obj) {
            arrCopy.push(copy(item));
        }
        return arrCopy as any;
    }
    const objCopy = {} as { [key: string]: any };
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            objCopy[key] = copy(obj[key]);
        }
    }
    return objCopy as T;
}