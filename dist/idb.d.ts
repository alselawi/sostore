export interface PersistenceLayer {
    get(key: string): Promise<string | undefined>;
    getBulk(keys: string[]): Promise<(string | undefined)[]>;
    set(key: string, value: string): Promise<void>;
    setBulk(entries: [string, string][]): Promise<void>;
    delBulk(keys: string[]): Promise<void>;
    clear(): Promise<void>;
    keys(): Promise<string[]>;
    values(): Promise<string[]>;
    setMetadata(key: string, value: any): Promise<void>;
    getMetadata(key: string): Promise<any>;
}
export type UseStore = <T>(txMode: IDBTransactionMode, callback: (store: IDBObjectStore) => T | PromiseLike<T>) => Promise<T>;
export declare class IDB implements PersistenceLayer {
    private store;
    private metadataStore;
    constructor(name: string);
    /**
     * Converts IDB requests/transactions to promises.
     */
    private pr;
    /**
     * Converts cursor iterations to promises.
     */
    private eachCursor;
    /**
     * Get a value by its key.
     */
    get(key: string): Promise<string | undefined>;
    /**
     * Get values for a given set of keys.
     */
    getBulk(keys: string[]): Promise<(string | undefined)[]>;
    /**
     * Set a value with a key.
     */
    set(key: string, value: string): Promise<void>;
    /**
     * Set multiple values at once. This is faster than calling set() multiple times.
     * It's also atomic – if one of the pairs can't be added, none will be added.
     */
    setBulk(entries: [string, string][]): Promise<void>;
    /**
     * Delete multiple keys at once.
     */
    delBulk(keys: string[]): Promise<void>;
    /**
     * Clear all values in the store.
     */
    clear(): Promise<void>;
    /**
     * Get all keys in the store.
     */
    keys(): Promise<string[]>;
    /**
     * Get all documents in the store.
     */
    values(): Promise<string[]>;
    /**
     * Get key by ID
     */
    byID(_id: string): Promise<IDBValidKey | undefined>;
    /**
     * Get length of the DB.
     */
    length(): Promise<number>;
    /**
     * Set metadata with a key.
     */
    setMetadata(key: string, value: string): Promise<void>;
    /**
     * Get metadata by its key.
     */
    getMetadata(key: string): Promise<string>;
    clearMetadata(): Promise<void>;
}
