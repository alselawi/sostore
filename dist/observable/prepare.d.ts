import { ObservableMeta } from "./meta";
import { observed } from "./types";
export declare const prepare: {
    object<T extends object>(source: T, oMeta: ObservableMeta<T>, visited: Set<any>): observed<T>;
    array<T extends any[]>(source: T, oMeta: ObservableMeta<T>, visited: Set<any>): observed<T>;
    getObservedOf(item: any, key: string | number | symbol, parent: any, visited?: Set<any>): any;
};
