import { proxiedArrayMethods } from "./arr";
import { Change } from "./change";
import { observed, Observer, PrepareFunction } from "./types";
/**
 * Meta object to be added to observable on preparation
 */
interface MetaProperties<T> {
    target: T;
    ownKey: symbol | number | string;
    parent: any | null;
    visited?: Set<any>;
}
export declare class ObservableMeta<T extends object> {
    parent: any;
    ownKey: string | number | symbol;
    observers: Observer<T>[];
    revocable: {
        proxy: observed<T>;
        revoke: () => void;
    };
    proxy: observed<T>;
    target: T;
    batches: [Observer<T>, Change<T>[]][];
    runningSilentWork: boolean;
    constructor(properties: MetaProperties<T>, cloningFunction: PrepareFunction<T>);
    detach(): T;
    set(target: T, key: number | string | symbol, value: any): boolean;
    deleteProperty(target: observed<T>, key: string | symbol): boolean;
    QueMicroTask(observableMeta: ObservableMeta<T>): void;
    callObservers(changes: Change<T>[]): void;
}
export declare class ObservableObjectMeta<T extends object> extends ObservableMeta<T> {
    constructor(properties: MetaProperties<T>);
    get(target: T, key: string | symbol, receiver: any): any;
}
export declare class ObservableArrayMeta<G, T extends Array<G>> extends ObservableMeta<any> {
    constructor(properties: MetaProperties<T>);
    get(target: T, key: keyof typeof proxiedArrayMethods): (<T_1 extends any[]>(this: observed<T_1>) => any) | (<T_1 extends any[]>(this: observed<T_1>) => number) | (<T_1 extends any[]>(this: observed<T_1>) => any) | (<T_1 extends any[]>(this: observed<T_1>) => number) | (<T_1 extends any[]>(this: observed<T_1>) => observed<T_1>) | (<T_1 extends any[]>(this: observed<T_1>, comparator: (a: any, b: any) => number) => observed<T_1>) | (<T_1 extends any[]>(this: observed<T_1>, filVal: any, start: number, end: number) => observed<T_1>) | (<T_1 extends any[]>(this: observed<T_1>, dest: number, start: number, end: number) => observed<T_1>) | (<T_1 extends any[]>(this: observed<T_1>) => any);
}
export {};
