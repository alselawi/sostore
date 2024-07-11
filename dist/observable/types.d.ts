import { Change } from "./change";
import { oMetaKey } from "./const";
import { ObservableMeta } from "./meta";
export type observed<T extends object> = T & {
    [oMetaKey]: ObservableMeta<T>;
};
export type PrepareFunction<T extends object> = (source: T, oMeta: ObservableMeta<T>, visited: Set<any>) => observed<T>;
export interface Observer<T extends object> {
    (changes: Change<T>[]): void;
}
