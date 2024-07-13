import { oMetaKey } from "./const";
import { ObservableArrayMeta, ObservableObjectMeta } from "./meta";
import * as utils from "./utils";
export const prepare = {
    object(source, oMeta, visited) {
        const target = {};
        target[oMetaKey] = oMeta;
        for (const key in source) {
            target[key] = prepare.getObservedOf(source[key], key, oMeta, visited);
        }
        // also copy methods, getters and setters
        utils.copyPropertiesTo(source, target);
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
