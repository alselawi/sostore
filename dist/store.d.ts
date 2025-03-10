import { LocalPersistence } from "./persistence/local";
import { Document, RecursivePartial } from "./model";
import { RemotePersistence } from "./persistence/remote";
export declare class Store<T extends Document> {
    deferredPresent: boolean;
    onSyncStart: () => void;
    onSyncEnd: () => void;
    private $$observableObject;
    private $$changes;
    private $$loaded;
    private $$localPersistence;
    private $$remotePersistence;
    private $$debounceRate;
    private $$lastProcessChanges;
    private $$model;
    private $$encode;
    private $$decode;
    constructor({ debounceRate, model, encode, decode, onSyncStart, onSyncEnd, localPersistence, remotePersistence, }?: {
        debounceRate?: number;
        model?: typeof Document;
        encode?: (input: string) => string;
        decode?: (input: string) => string;
        onSyncStart?: () => void;
        onSyncEnd?: () => void;
        localPersistence?: LocalPersistence;
        remotePersistence?: RemotePersistence;
    });
    /**
     * Serializes an item of type T into an encoded JSON string.
     * Date objects are converted to a custom format before encoding.
     * @param item An instance of type T which extends Document.
     * @returns An encoded JSON string representing the item.
     */
    private $$serialize;
    /**
     * Decodes a serialized string, parses it into a JavaScript object, and converts custom date formats back into Date objects.
     * @param line A string representing the serialized data.
     * @returns A new instance of the model with the deserialized data.
     */
    private $$deserialize;
    /**
     * Loads data from an IndexedDB instance, deserializes it, and updates the observable array silently without triggering observers.
     */
    private $$loadFromLocal;
    private $$processChanges;
    private $$setupObservers;
    /**
     *
     * Sync mechanism and explanation:
     * The remote sync server maintains a change log, where set of changes (for a set of rows) are stored.
     * Each change is referred as a version.
     * version number is actually a timestamp.
     *
     * By comparing the local version with the remote version, we can determine if there are any changes to be fetched.
     * If there's a difference, we fetch the changed rows from the remote server since our local version.
     * Hence, our local version is updated to the latest version only through this mechanism
     * this is why we may get redundant updates from the remote server
     * (since we may send updates but not ask for the latest version)
     *
     * Local updates are automatically sent to the remote server.
     * If there's an error during sending updates, the updates are stored in a deferred array.
     * ***************************************************************************
     *
     * The sync mechanism is as follows:
     * 1. Fetch the local version
     * 2. Fetch the remote version
     * 3. If the versions match, there's nothing to do
     * 4. If the versions don't match, fetch the updates from the remote server (this would also give us the latest version number)
     * 5. check the deferred array for items that have not been sent (due to an error, or offline)
     * 6. compare the local and remote updates for conflicts (latest write wins)
     * 7. write the remote updates to the local store
     * 8. write the local updates to the remote store
     * 9. reset the deferred array (set it to empty)
     * 10. set the local version to the remote version that has been given when fetching for new documents (step 4)
     * 11. re-load the local data to the observable array
     * 12. return the number of pushed and pulled updates
     * **************************************************************************
     */
    private $$syncTry;
    private $$sync;
    /**
     * List of all items in the store (excluding deleted items)
     */
    get list(): T[];
    /**
     * List of all items in the store (including deleted items) However, the list is not observable
     */
    get copy(): T[];
    /**
     * Fetch document by ID
     */
    get(id: string): T | undefined;
    /**
     * Add document (will model it as well)
     */
    add(item: RecursivePartial<T>): void;
    /**
     * Restore item after deletion
     */
    restoreItem(id: string): void;
    /**
     * delete Item (by ID)
     */
    delete(id: string): void;
    /**
     * Update item properties (by ID)
     */
    update(id: string, item: RecursivePartial<T>): void;
    /**
     * Synchronize local with remote database
     */
    sync: () => Promise<ReturnType<() => Promise<{
        exception?: string;
        pushed?: number;
        pulled?: number;
    }[]>>>;
    /**
     * whether the local database is in sync with the remote database
     */
    inSync(): Promise<boolean>;
    /**
     * whether the local database has fully loaded
     */
    get loaded(): Promise<void>;
    /**
     * Whether the remote database is currently online
     */
    get isOnline(): boolean;
    /**
     * Backup the local store, returns a string that can be used to restore the backup
     */
    backup(): Promise<string>;
    /**
     * Restore the local store from a backup
     * @param input the backup string
     */
    restoreBackup(input: string): Promise<{
        pushed?: number;
        pulled?: number;
        conflicts?: number;
        exception?: string;
    }[]>;
}
