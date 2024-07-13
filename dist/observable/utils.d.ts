import { ObservableMeta } from "./meta";
export declare function findGrandParent<T extends object>(observable: ObservableMeta<T>): ObservableMeta<T>;
export declare function copy<T>(obj: T): T;
export declare function copyPropertiesTo(source: any, target: object): void;
export declare function isTrueObj(obj: any): boolean;
