import { oMetaKey } from "./const";
import { ObservableArrayMeta, ObservableMeta, ObservableObjectMeta } from "./meta";
import { observed } from "./types";
import * as utils from "./utils";

export const prepare = {
	object<T extends object>(
		source: T,
		oMeta: ObservableMeta<T>,
		visited: Set<any>
	): observed<T> {
		const target: observed<T> = {} as any;
		target[oMetaKey] = oMeta;
		for (const key in source) {
			target[key] = prepare.getObservedOf(source[key], key, oMeta, visited);
		}
		// also copy methods, getters and setters
		utils.copyPropertiesTo(source, target);
		return target;
	},

	array<T extends any[]>(
		source: T,
		oMeta: ObservableMeta<T>,
		visited: Set<any>
	): observed<T> {
		let l = source.length;
		const target: observed<T> = new Array(l) as any;
		target[oMetaKey] = oMeta;
		for (let i = 0; i < l; i++) {
			target[i] = prepare.getObservedOf(source[i], i, oMeta, visited);
		}
		return target;
	},

	getObservedOf(
		item: any,
		key: string | number | symbol,
		parent: any,
		visited?: Set<any>
	) {
		if (visited !== undefined && visited.has(item)) {
			return null;
		} else if (typeof item !== "object" || item === null) {
			return item;
		} else if (Array.isArray(item)) {
			return new ObservableArrayMeta({
				target: item,
				ownKey: key,
				parent: parent,
				visited,
			}).proxy;
		} else if (item instanceof Date) {
			return item;
		} else {
			return new ObservableObjectMeta({
				target: item,
				ownKey: key,
				parent: parent,
				visited,
			}).proxy;
		}
	},
};
