
export interface PersistenceLayer {
	get(key: string): Promise<string | undefined>
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

export type UseStore = <T>(
	txMode: IDBTransactionMode,
	callback: (store: IDBObjectStore) => T | PromiseLike<T>
) => Promise<T>;

export class IDB implements PersistenceLayer {
	private store: UseStore;
	private metadataStore: UseStore;

	constructor(name: string) {
		const request = indexedDB.open(name);
		request.onupgradeneeded = function (event) {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(name)) {
				const objectStore = db.createObjectStore(name);
				objectStore.createIndex("idIndex", "_id", { unique: true });
			}
			if (!db.objectStoreNames.contains('metadata')) {
				db.createObjectStore('metadata');
			}
		};
		const dbp = this.pr(request);
		this.store = (txMode, callback) =>
			dbp.then((db) =>
				callback(
					db.transaction(name, txMode, { durability: "relaxed" }).objectStore(name)
				)
			);
		this.metadataStore = (txMode, callback) =>
			dbp.then((db) =>
				callback(
					db.transaction('metadata', txMode, { durability: "relaxed" }).objectStore('metadata')
				)
			);
	}

	/**
	 * Converts IDB requests/transactions to promises.
	 */
	private pr<T>(req: IDBRequest<T> | IDBTransaction): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			// @ts-ignore - file size hacks
			req.oncomplete = req.onsuccess = () => resolve(req.result);
			// @ts-ignore - file size hacks
			req.onabort = req.onerror = () => reject(req.error);
		});
	}

	/**
	 * Converts cursor iterations to promises.
	 */
	private eachCursor(
		store: IDBObjectStore,
		callback: (cursor: IDBCursorWithValue) => void
	): Promise<void> {
		store.openCursor().onsuccess = function () {
			if (!this.result) return;
			callback(this.result);
			this.result.continue();
		};
		return this.pr(store.transaction);
	}

	/**
	 * Get a value by its key.
	 */
	get(key: string): Promise<string | undefined> {
		return this.store("readonly", (store) => this.pr(store.get(key)));
	}

	/**
	 * Get values for a given set of keys.
	 */
	async getBulk(keys: string[]): Promise<(string | undefined)[]> {
		return this.store("readonly", async (store) => {
			return Promise.all(keys.map((x) => this.pr(store.get(x))));
		});
	}

	/**
	 * Set a value with a key.
	 */
	set(key: string, value: string): Promise<void> {
		return this.store("readwrite", (store) => {
			store.put(value, key);
			return this.pr(store.transaction);
		});
	}

	/**
	 * Set multiple values at once. This is faster than calling set() multiple times.
	 * It's also atomic – if one of the pairs can't be added, none will be added.
	 */
	setBulk(entries: [string, string][]): Promise<void> {
		return this.store("readwrite", (store) => {
			entries.forEach((entry) => store.put(entry[1], entry[0]));
			return this.pr(store.transaction);
		});
	}

	/**
	 * Delete multiple keys at once.
	 */
	delBulk(keys: string[]): Promise<void> {
		return this.store("readwrite", (store: IDBObjectStore) => {
			keys.forEach((key: string) => store.delete(key));
			return this.pr(store.transaction);
		});
	}

	/**
	 * Clear all values in the store.
	 */
	clear(): Promise<void> {
		return this.store("readwrite", (store) => {
			store.clear();
			return this.pr(store.transaction);
		});
	}

	/**
	 * Get all keys in the store.
	 */
	keys(): Promise<string[]> {
		return this.store("readonly", async (store) => {
			// Fast path for modern browsers
			if (store.getAllKeys) {
				return this.pr(store.getAllKeys() as IDBRequest<string[]>);
			}

			const items: string[] = [];
			await this.eachCursor(store, (cursor) => items.push(cursor.key as string));
			return items;
		});
	}

	/**
	 * Get all documents in the store.
	 */
	values(): Promise<string[]> {
		return this.store("readonly", async (store) => {
			// Fast path for modern browsers
			if (store.getAll) {
				return this.pr(store.getAll() as IDBRequest<string[]>);
			}

			const items: string[] = [];
			await this.eachCursor(store, (cursor) => items.push(cursor.value as string));
			return items;
		});
	}

	/**
	 * Get key by ID
	 */
	async byID(_id: string) {
		return this.store("readonly", (store) => {
			return this.pr(store.index("idIndex").getKey(_id));
		});
	}

	/**
	 * Get length of the DB.
	 */
	async length() {
		return (await this.keys()).length;
	}

	/**
	 * Set metadata with a key.
	 */
	setMetadata(key: string, value: string): Promise<void> {
		return this.metadataStore("readwrite", (store) => {
			store.put(value, key);
			return this.pr(store.transaction);
		});
	}

	/**
	 * Get metadata by its key.
	 */
	getMetadata(key: string): Promise<string> {
		return this.metadataStore("readonly", (store) => this.pr(store.get(key)));
	}

	clearMetadata(): Promise<void> {
		return this.metadataStore("readwrite", (store) => {
			store.clear();
			return this.pr(store.transaction);
		});
	}
}
