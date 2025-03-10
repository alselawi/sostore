import { Change, Observable } from "./observable";
import { deferredArray, Dump, LocalPersistence } from "./persistence/local";
import { debounce } from "./debounce";
import { Document, RecursivePartial } from "./model";
import { RemotePersistence } from "./persistence/remote";

export class Store<T extends Document> {
	public deferredPresent: boolean = false;
	public onSyncStart: () => void = () => {};
	public onSyncEnd: () => void = () => {};
	private $$observableObject: Observable<T[]> = new Observable([] as T[]);
	private $$changes: Change<T[]>[] = [];
	private $$loaded: boolean = false;
	private $$localPersistence: LocalPersistence | undefined;
	private $$remotePersistence: RemotePersistence | undefined;
	private $$debounceRate: number = 100;
	private $$lastProcessChanges: number = 0;
	private $$model: typeof Document = Document;
	private $$encode: (input: string) => string = (x) => x;
	private $$decode: (input: string) => string = (x) => x;

	constructor({
		debounceRate,
		model,
		encode,
		decode,
		onSyncStart,
		onSyncEnd,
		localPersistence,
		remotePersistence,
	}: {
		debounceRate?: number;
		model?: typeof Document;
		encode?: (input: string) => string;
		decode?: (input: string) => string;
		onSyncStart?: () => void;
		onSyncEnd?: () => void;
		localPersistence?: LocalPersistence;
		remotePersistence?: RemotePersistence;
	} = {}) {
		this.$$model = model || Document;
		if (onSyncStart) {
			this.onSyncStart = onSyncStart;
		}
		if (onSyncEnd) {
			this.onSyncEnd = onSyncEnd;
		}
		if (encode) {
			this.$$encode = encode;
		}
		if (decode) {
			this.$$decode = decode;
		}
		if (typeof debounceRate === "number") {
			this.$$debounceRate = debounceRate;
		}
		if (localPersistence) {
			this.$$localPersistence = localPersistence;
			this.$$loadFromLocal();
			this.$$setupObservers();
		}
		if (remotePersistence) {
			this.$$remotePersistence = remotePersistence;
		}
	}

	/**
	 * Serializes an item of type T into an encoded JSON string.
	 * Date objects are converted to a custom format before encoding.
	 * @param item An instance of type T which extends Document.
	 * @returns An encoded JSON string representing the item.
	 */
	private $$serialize(item: T): string {
		const stripped = item._stripDefaults ? item._stripDefaults() : item;
		const str = JSON.stringify(stripped, function (key, value) {
			if (value === undefined) return undefined;
			if (value === null) return null;
			if (typeof this[key].getTime === "function")
				return { $$date: this[key].getTime() };
			return value;
		});
		return this.$$encode(str);
	}

	/**
	 * Decodes a serialized string, parses it into a JavaScript object, and converts custom date formats back into Date objects.
	 * @param line A string representing the serialized data.
	 * @returns A new instance of the model with the deserialized data.
	 */
	private $$deserialize(line: string): any {
		line = this.$$decode(line);
		const item = JSON.parse(line, (key, val) => {
			if (key === "$$date") return new Date(val);
			const t = typeof val;
			if (t === "string" || t === "number" || t === "boolean" || val === null)
				return val;
			if (val && val.$$date) return val.$$date;
			return val;
		});
		return this.$$model.new(item);
	}

	/**
	 * Loads data from an IndexedDB instance, deserializes it, and updates the observable array silently without triggering observers.
	 */
	private async $$loadFromLocal(): Promise<void> {
		// Check if IndexedDB instance is available
		if (!this.$$localPersistence) return;

		// Retrieve values from IndexedDB and deserialize them
		const deserialized: T[] = await Promise.all(
			(await this.$$localPersistence.getAll()).map((x) => this.$$deserialize(x))
		);

		// Update the observable array silently with deserialized data
		this.$$observableObject.silently((o) => {
			o.splice(0, o.length, ...deserialized);
			this.$$loaded = true;
		});
	}

	private async $$processChanges() {
		if (!this.$$localPersistence) return;
		if (this.$$changes.length === 0) return;
		this.onSyncStart();
		this.$$lastProcessChanges = Date.now();

		const toWrite: [string, string][] = [];
		const toDeffer: deferredArray = [];
		const changesToProcess = [...this.$$changes]; // Create a copy of changes to process

		this.$$changes = []; // Clear the original changes array

		for (let index = 0; index < changesToProcess.length; index++) {
			const change = changesToProcess[index];
			const item = change.snapshot[change.path[0] as number];
			const serializedLine = this.$$serialize(item);
			toWrite.push([item.id, serializedLine]);
			toDeffer.push({
				ts: Date.now(),
				id: item.id,
			});
		}

		await this.$$localPersistence.put(toWrite);
		let deferredArray = await this.$$localPersistence.getDeferred();
		if (
			this.isOnline &&
			this.$$remotePersistence &&
			deferredArray.length === 0
		) {
			try {
				await this.$$remotePersistence.put(toWrite);
				this.onSyncEnd();
				return;
			} catch (e) {
				console.error("Will defer updates, due to error during sending.");
				console.error(e);
			}
		}

		/**
		 * If:
		 * 1. There are already deferred updates
		 * 2. There's an error during sending updates to the remote server
		 * 3. We're offline
		 */
		if (this.$$remotePersistence) {
			await this.$$localPersistence.putDeferred(
				deferredArray.concat(...toDeffer)
			);
			this.deferredPresent = true;
		}
		this.onSyncEnd();
	}

	private $$setupObservers() {
		this.$$observableObject.observe(async (changes) => {
			for (const change of changes) {
				if (change.type === "insert" || change.type === "update") {
					// remove existing changes for the same item
					this.$$changes = this.$$changes.filter(
						(x) =>
							x.snapshot[x.path[0] as number].id !==
							change.snapshot[change.path[0] as number].id
					);
					this.$$changes.push(change);
				}
			}
			const nextRun =
				this.$$lastProcessChanges + this.$$debounceRate - Date.now();
			setTimeout(
				() => {
					this.$$processChanges();
				},
				nextRun > 0 ? nextRun : 0
			);
		});
	}

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
	private async $$syncTry(): Promise<{
		pushed?: number;
		pulled?: number;
		conflicts?: number;
		exception?: string;
	}> {
		if (!this.$$localPersistence) {
			return {
				exception: "Local persistence not available",
			};
		}
		if (!this.$$remotePersistence) {
			return {
				exception: "Remote persistence not available",
			};
		}
		if (!this.isOnline) {
			return {
				exception: "Offline",
			};
		}
		try {
			const localVersion = await this.$$localPersistence.getVersion();
			const remoteVersion = await this.$$remotePersistence.getVersion();
			let deferredArray = await this.$$localPersistence.getDeferred();
			let conflicts = 0;

			if (localVersion === remoteVersion && deferredArray.length === 0) {
				return {
					exception: "Nothing to sync",
				};
			}

			// fetch updates since our local version
			const remoteUpdates = await this.$$remotePersistence.getSince(
				localVersion
			);

			// check for conflicts
			deferredArray = deferredArray.filter((x) => {
				const conflict = remoteUpdates.rows.findIndex((y) => y.id === x.id);
				// take row-specific version if available, otherwise rely on latest version
				const comparison = Number(
					(
						remoteUpdates.rows[conflict] as
							| { id: string; data: string; ts?: string }
							| undefined
					)?.ts || remoteVersion
				);
				if (conflict === -1) {
					return true;
				} else if (x.ts > comparison) {
					// there's a conflict, but the local change is newer
					remoteUpdates.rows.splice(conflict, 1);
					conflicts++;
					return true;
				} else {
					// there's a conflict, and the remote change is newer
					conflicts++;
					return false;
				}
			});

			// now we have local and remote to update
			// we should start with remote
			await this.$$localPersistence.put(
				remoteUpdates.rows.map((row) => [row.id, row.data])
			);

			// then local
			const updatedRows = new Map();
			for (const d of deferredArray) {
				updatedRows.set(d.id, await this.$$localPersistence.getOne(d.id));
				// latest deferred write wins since it would overwrite the previous one
			}
			await this.$$remotePersistence.put(
				[...updatedRows.keys()].map((x) => [x, updatedRows.get(x)])
			);

			// reset deferred
			await this.$$localPersistence.putDeferred([]);
			this.deferredPresent = false;

			// set local version to the version given by the current request
			// this might be outdated as soon as this functions ends
			// that's why this function will run on a while loop (below)
			await this.$$localPersistence.putVersion(remoteUpdates.version);

			// but if we had deferred updates then the remoteUpdates.version is outdated
			// so we need to fetch the latest version again
			// however, we should not do this in the same run since there might be updates
			// from another client between the time we fetched the remoteUpdates and the
			// time we sent deferred updates
			// so every sync should be followed by another sync
			// until the versions match
			// this is why there's another private sync method

			// finally re-load local data
			await this.$$loadFromLocal();

			let pushed = deferredArray.length;
			let pulled = remoteUpdates.rows.length;
			return { pushed, pulled, conflicts };
		} catch (e) {
			console.error(e);
			return {
				exception: "Error during synchronization",
			};
		}
	}

	private async $$sync() {
		this.onSyncStart();
		let tries: { exception?: string; pushed?: number; pulled?: number }[] = [];
		try {
			let exceptionOccurred = false;
			while (!exceptionOccurred) {
				const result = await this.$$syncTry();
				if (result.exception) {
					exceptionOccurred = true;
				}
				tries.push(result);
			}
		} catch (e) {
			console.error(e);
		}
		this.onSyncEnd();
		return tries;
	}

	// ----------------------------- PUBLIC API -----------------------------

	/**
	 * List of all items in the store (excluding deleted items)
	 */
	get list() {
		return this.$$observableObject.target.filter((x) => !x.$$deleted);
	}

	/**
	 * List of all items in the store (including deleted items) However, the list is not observable
	 */
	get copy() {
		return this.$$observableObject.copy;
	}

	/**
	 * Fetch document by ID
	 */
	get(id: string) {
		return this.$$observableObject.target.find((x) => x.id === id);
	}

	/**
	 * Add document (will model it as well)
	 */
	add(item: RecursivePartial<T>) {
		if (this.$$observableObject.target.find((x) => x.id === item.id)) {
			throw new Error("Duplicate ID detected: " + JSON.stringify(item.id));
		}
		let modeledItem = this.$$model.new(item) as T;
		this.$$observableObject.target.push(modeledItem);
	}

	/**
	 * Restore item after deletion
	 */
	restoreItem(id: string) {
		const item = this.$$observableObject.target.find((x) => x.id === id);
		if (!item) {
			throw new Error("Item not found.");
		}
		delete item.$$deleted;
	}

	/**
	 * delete Item (by ID)
	 */
	delete(id: string) {
		const index = this.$$observableObject.target.findIndex((x) => x.id === id);
		if (index === -1) {
			throw new Error("Item not found.");
		}
		this.$$observableObject.target[index].$$deleted = true;
	}

	/**
	 * Update item properties (by ID)
	 */
	update(id: string, item: RecursivePartial<T>) {
		const index = this.$$observableObject.target.findIndex((x) => x.id === id);
		if (index === -1) {
			throw new Error("Item not found.");
		}
		if (this.$$observableObject.target[index].id !== item.id) {
			throw new Error("ID mismatch.");
		}
		Object.keys(item).forEach((key) => {
			(this.$$observableObject.target as any)[index][key] =
				item[key as keyof T];
		});
	}

	/**
	 * Synchronize local with remote database
	 */
	sync = debounce(this.$$sync.bind(this), this.$$debounceRate);

	/**
	 * whether the local database is in sync with the remote database
	 */
	async inSync() {
		if (this.$$localPersistence && this.$$remotePersistence) {
			return (
				(await this.$$localPersistence.getVersion()) ===
				(await this.$$remotePersistence.getVersion())
			);
		} else return false;
	}

	/**
	 * whether the local database has fully loaded
	 */
	get loaded() {
		return new Promise<void>((resolve) => {
			let i = setInterval(() => {
				if (this.$$loaded) {
					clearInterval(i);
					resolve();
				}
			}, 100);
		});
	}

	/**
	 * Whether the remote database is currently online
	 */
	get isOnline() {
		if (!this.$$remotePersistence) return false;
		return this.$$remotePersistence.isOnline;
	}

	/**
	 * Backup the local store, returns a string that can be used to restore the backup
	 */
	async backup() {
		if (!this.$$localPersistence) {
			throw new Error("Local persistence not available");
		}
		return JSON.stringify(await this.$$localPersistence.dump());
	}

	/**
	 * Restore the local store from a backup
	 * @param input the backup string
	 */
	async restoreBackup(input: string): Promise<
		{
			pushed?: number;
			pulled?: number;
			conflicts?: number;
			exception?: string;
		}[]
	> {
		if (this.$$remotePersistence) {
			await this.$$remotePersistence.checkOnline();
			if (!this.$$remotePersistence.isOnline) {
				throw new Error("Can not restore backup when the client is offline!");
			}
		}
		const dump = JSON.parse(input) as Dump;
		if (!this.$$localPersistence) {
			throw new Error("Local persistence not available");
		}
		await this.$$localPersistence.put(dump.data);
		await this.$$localPersistence.putDeferred(dump.metadata.deferred);
		await this.$$localPersistence.putVersion(dump.metadata.version);
		await this.$$loadFromLocal();
		if (this.$$remotePersistence) {
			await this.$$remotePersistence.put(dump.data);
			return await this.sync(); // to get latest version number
		}
		return [];
	}
}
