import { Change, Observable } from "./observable";
import { deferredArray, LocalPersistence } from "./persistence/local";
import { debounce } from "./debounce";
import { Document } from "./model";
import { RemotePersistence } from "./persistence/remote";

export class Store<
	T extends Document,
> {
	public isOnline = true;
	public deferredPresent: boolean = false;
	public onSyncStart: () => void = () => {};
	public onSyncEnd: () => void = () => {};
	private $$observableObject: Observable<T> = new Observable([] as T[]);
	private $$changes: Change<T[]>[] = [];
	private $$token: string | undefined;
	private $$localPersistence: LocalPersistence | undefined;
	private $$remotePersistence: RemotePersistence | undefined;
	private $$debounceRate: number = 100;
	private $$lastProcessChanges: number = 0;
	private $$model: typeof Document;
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
				data: serializedLine,
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
		await this.$$localPersistence.putDeferred(
			deferredArray.concat(...toDeffer)
		);
		this.deferredPresent = true;
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
				let item = this.$$deserialize(x.data);
				const conflict = remoteUpdates.rows.findIndex((y) => y.id === item.id);
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
					return true;
				} else {
					// there's a conflict, and the remote change is newer
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
			for (const local of deferredArray) {
				let item = this.$$deserialize(local.data);
				updatedRows.set(item.id, local.data);
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
			return { pushed, pulled };
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

	/**
	 * Public methods, to be used by the application
	 */
	get list() {
		return this.$$observableObject.target.filter((x) => !x.$$deleted);
	}

	copy = this.$$observableObject.copy;

	getByID(id: string) {
		return this.$$observableObject.target.find((x) => x.id === id);
	}

	add(item: T) {
		if (this.$$observableObject.target.find((x) => x.id === item.id)) {
			throw new Error("Duplicate ID detected: " + JSON.stringify(item.id));
		}
		this.$$observableObject.target.push(item);
	}

	delete(item: T) {
		const index = this.$$observableObject.target.findIndex(
			(x) => x.id === item.id
		);
		if (index === -1) {
			throw new Error("Item not found.");
		}
		this.deleteByIndex(index);
	}

	deleteByIndex(index: number) {
		if (!this.$$observableObject.target[index]) {
			throw new Error("Item not found.");
		}
		this.$$observableObject.target[index].$$deleted = true;
	}

	deleteByID(id: string) {
		const index = this.$$observableObject.target.findIndex((x) => x.id === id);
		if (index === -1) {
			throw new Error("Item not found.");
		}
		this.deleteByIndex(index);
	}

	updateByIndex(index: number, item: T) {
		if (!this.$$observableObject.target[index]) {
			throw new Error("Item not found.");
		}
		if (this.$$observableObject.target[index].id !== item.id) {
			throw new Error("ID mismatch.");
		}
		this.$$observableObject.target[index] = item;
	}

	sync = debounce(this.$$sync.bind(this), this.$$debounceRate);

	async isUpdated() {
		if (this.$$localPersistence && this.$$remotePersistence) {
			return (
				(await this.$$localPersistence.getVersion()) ===
				(await this.$$remotePersistence.getVersion())
			);
		} else return false;
	}
}