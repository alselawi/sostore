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

export function findGrandParent<T extends object>(
	observable: ObservableMeta<T>
): ObservableMeta<T> {
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

export function copyPropertiesTo(source: any, target: object) {
	const prototype = Object.getPrototypeOf(source);
	const propertyNames = [
		...Object.getOwnPropertyNames(source),
		...Object.getOwnPropertyNames(prototype),
	];
	propertyNames.forEach((name) => {
		if (name !== "constructor") {
			const descriptor =
				Object.getOwnPropertyDescriptor(source, name) ||
				Object.getOwnPropertyDescriptor(prototype, name);
			const isMethod = typeof descriptor?.value === "function";
			const hasGetter = typeof descriptor?.get === "function";
			const hasSetter = typeof descriptor?.set === "function";
			if (descriptor && (isMethod || hasGetter || hasSetter)) {
				Object.defineProperty(target, name, descriptor);
			}
		}
	});
}

export function isTrueObj(obj: any): boolean {
	// Check if it's an object
	if (typeof obj !== "object" || obj === null) {
		return false;
	}

	// check if it is a data
	if (obj.constructor === Date) {
		return false;
	}

	if (Array.isArray(obj)) {
		return false;
	}

	// Check if the prototype's constructor is the same as the object's constructor
	return Object.getPrototypeOf(obj).constructor === obj.constructor;
}
