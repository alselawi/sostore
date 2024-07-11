import { Document } from "./model";
import { Store } from "./store";
/**
 * Enhances a React component to automatically re-render when the observed store changes.
 * @param store - An instance of Store that extends Document.
 * @returns A higher-order function that takes a React component as an argument.
 */
export declare function observe<D extends Document, G extends Store<D>>(store: G | G[]): (component: any) => any;
