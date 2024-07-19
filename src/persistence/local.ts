import { Persistence } from "./type";

export type deferredArray = { ts: number; id: string }[];

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

type UseStore = <T>(
	txMode: IDBTransactionMode,
	callback: (store: IDBObjectStore) => T | PromiseLike<T>
) => Promise<T>;

export class IDB implements LocalPersistence {
	private store: UseStore;
	private metadataStore: UseStore;

	constructor({ name }: { name: string }) {
		const request = indexedDB.open(name);
		request.onupgradeneeded = function (event) {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(name)) {
				const objectStore = db.createObjectStore(name);
				objectStore.createIndex("idIndex", "_id", { unique: true });
			}
			if (!db.objectStoreNames.contains("metadata")) {
				db.createObjectStore("metadata");
			}
		};
		const dbp = this.pr(request);
		this.store = (txMode, callback) =>
			dbp.then((db) =>
				callback(
					db
						.transaction(name, txMode, { durability: "relaxed" })
						.objectStore(name)
				)
			);
		this.metadataStore = (txMode, callback) =>
			dbp.then((db) =>
				callback(
					db
						.transaction("metadata", txMode, { durability: "relaxed" })
						.objectStore("metadata")
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
	 * Set multiple values at once. This is faster than calling set() multiple times.
	 * It's also atomic – if one of the pairs can't be added, none will be added.
	 */
	put(entries: [string, string][]): Promise<void> {
		return this.store("readwrite", (store) => {
			entries.forEach((entry) => store.put(entry[1], entry[0]));
			return this.pr(store.transaction);
		});
	}

	/**
	 * Get all documents in the store.
	 */
	getAll() {
		return this.store("readonly", async (store) => {
			let rows: string[] = [];
			if (store.getAll) {
				rows = await this.pr(store.getAll() as IDBRequest<string[]>);
			} else {
				await this.eachCursor(store, (cursor) =>
					rows.push(cursor.value as string)
				);
			}
			return rows;
		});
	}

	getOne(id: string): Promise<string> {
		return this.store("readonly", (store) =>
			this.pr(store.get(id) as IDBRequest<string>)
		);
	}

	async getVersion() {
		return Number((await this.getMetadata("version")) || 0);
	}

	async putVersion(version: number) {
		await this.setMetadata("version", JSON.stringify(version));
	}

	async getDeferred(): Promise<deferredArray> {
		return JSON.parse((await this.getMetadata("deferred")) || "[]");
	}

	async putDeferred(arr: deferredArray): Promise<void> {
		await this.setMetadata("deferred", JSON.stringify(arr));
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

	/**
	 * Clear all values in the store.
	 */
	clear(): Promise<void> {
		return this.store("readwrite", (store) => {
			store.clear();
			return this.pr(store.transaction);
		});
	}

	clearMetadata(): Promise<void> {
		return this.metadataStore("readwrite", (store) => {
			store.clear();
			return this.pr(store.transaction);
		});
	}

	dump() {
		return this.store("readonly", async (store) => {
			let data: [string, string][] = [];
			if (store.getAll && store.getAllKeys) {
				const keys: string[] = await this.pr(
					store.getAllKeys() as IDBRequest<string[]>
				);
				const values: string[] = await this.pr(
					store.getAll() as IDBRequest<string[]>
				);
				data = keys.map((key, index) => [key, values[index]]);
			} else {
				await this.eachCursor(store, (cursor) => {
					data.push([cursor.key as string, cursor.value as string]);
				});
			}
			return {
				data,
				metadata: {
					version: await this.getVersion(),
					deferred: await this.getDeferred(),
				},
			};
		});
	}
}
