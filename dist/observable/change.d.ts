import { observed } from "./types";
/**
 * Change class:
 * any change that would be sent to the observer will contain this class properties
 */
export declare class Change<D extends object> {
    type: "insert" | "update" | "delete" | "reverse" | "shuffle";
    path: (string | number | symbol)[];
    value?: any;
    oldValue?: any;
    object: any;
    snapshot: observed<D>;
    constructor(type: typeof this.type, path: (string | number | symbol)[], value: any | undefined, oldValue: any | undefined, object: any, snapshot: observed<D>);
}
