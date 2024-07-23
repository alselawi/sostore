import { Persistence } from "./type";
export type deferredArray = {
    ts: number;
    id: string;
}[];
export interface Dump {
    data: [string, string][];
    metadata: {
        version: number;
        deferred: deferredArray;
    };
}
export interface LocalPersistence extends Persistence {
    getAll(): Promise<string[]>;
    getOne(id: string): Promise<string>;
    putVersion(number: number): Promise<void>;
    getDeferred(): Promise<deferredArray>;
    putDeferred(arr: deferredArray): Promise<void>;
    dump(): Promise<Dump>;
}
export declare class IDB implements LocalPersistence {
    private store;
    private metadataStore;
    constructor({ name }: {
        name: string;
    });
    /**
     * Converts IDB requests/transactions to promises.
     */
    private pr;
    /**
     * Converts cursor iterations to promises.
     */
    private eachCursor;
    /**
     * Set multiple values at once. This is faster than calling set() multiple times.
     * It's also atomic – if one of the pairs can't be added, none will be added.
     */
    put(entries: [string, string][]): Promise<void>;
    /**
     * Get all documents in the store.
     */
    getAll(): Promise<string[]>;
    getOne(id: string): Promise<string>;
    getVersion(): Promise<number>;
    putVersion(version: number): Promise<void>;
    getDeferred(): Promise<deferredArray>;
    putDeferred(arr: deferredArray): Promise<void>;
    /**
     * Set metadata with a key.
     */
    setMetadata(key: string, value: string): Promise<void>;
    /**
     * Get metadata by its key.
     */
    getMetadata(key: string): Promise<string>;
    /**
     * Clear all values in the store.
     */
    clear(): Promise<void>;
    clearMetadata(): Promise<void>;
    dump(): Promise<{
        data: [string, string][];
        metadata: {
            version: number;
            deferred: deferredArray;
        };
    }>;
}
