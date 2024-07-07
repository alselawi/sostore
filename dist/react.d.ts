import { Document } from "./model";
import { Store } from "./store";
export declare function observe<D extends Document, G extends Store<D>>(store: G): (component: any) => any;
