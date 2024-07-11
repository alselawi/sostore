import { observed } from "./types";
/***
 * Proxied Array methods
 */
declare function proxiedPop<T extends any[]>(this: observed<T>): any;
declare function proxiedPush<T extends any[]>(this: observed<T>): number;
declare function proxiedShift<T extends any[]>(this: observed<T>): any;
declare function proxiedUnshift<T extends any[]>(this: observed<T>): number;
declare function proxiedReverse<T extends any[]>(this: observed<T>): observed<T>;
declare function proxiedSort<T extends any[]>(this: observed<T>, comparator: (a: any, b: any) => number): observed<T>;
declare function proxiedFill<T extends any[]>(this: observed<T>, filVal: any, start: number, end: number): observed<T>;
declare function proxiedCopyWithin<T extends any[]>(this: observed<T>, dest: number, start: number, end: number): observed<T>;
declare function proxiedSplice<T extends any[]>(this: observed<T>): any;
export declare const proxiedArrayMethods: {
    pop: typeof proxiedPop;
    push: typeof proxiedPush;
    shift: typeof proxiedShift;
    unshift: typeof proxiedUnshift;
    reverse: typeof proxiedReverse;
    sort: typeof proxiedSort;
    fill: typeof proxiedFill;
    copyWithin: typeof proxiedCopyWithin;
    splice: typeof proxiedSplice;
};
export {};
