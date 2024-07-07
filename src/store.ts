import { Change, observable, ObservableArray } from "./observable";
import { IDB } from "./idb";
import { SyncService } from "./sync-service";
import { debounce } from "./debounce";
import { Document, RecursivePartial } from "./model";

export type deferredArray = { ts: number; data: string }[];

export class Store<T extends Document> {
	public isOnline = true;
	public deferredPresent: boolean = false;

	private $$idb: IDB;
	private $$observableObject: ObservableArray<T[]> = observable([] as T[]);
	private $$changes: Change<T[]>[] = [];
	private $$token: string;
	private $$syncService: SyncService | null = null;
	private $$debounceRate: number = 100;
	private $$lastProcessChanges: number = 0;
	private $$model: typeof Document;
	private $$encode: (input: string) => string = (x) => x;
	private $$decode: (input: string) => string = (x) => x;

	constructor({
		name,
		token,
		persist = true,
		endpoint,
		debounceRate,
		model,
		encode,
		decode,
	}: {
		name: string;
		token: string;
		persist?: boolean;
		endpoint?: string;
		debounceRate?: number;
		model?: typeof Document;
		encode?: (input: string) => string;
		decode?: (input: string) => string;
	}) {
		this.$$idb = new IDB(name);
		this.$$token = token;
		this.$$model = model || Document;
		if (encode) {
			this.$$encode = encode;
		}
		if (decode) {
			this.$$decode = decode;
		}
		if (typeof debounceRate === "number") {
			this.$$debounceRate = debounceRate;
		}
		if (persist && endpoint) {
			this.$$loadFromLocal();
			this.$$setupObservers();
			this.$$syncService = new SyncService(endpoint, this.$$token, name);
		}
	}

	private $$serialize(item: T) {
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

	private $$deserialize(line: string) {
		line = this.$$decode(line);
		const item = JSON.parse(line, function (key, val) {
			if (key === "$$date") return new Date(val);
			let t = typeof val;
			if (t === "string" || t === "number" || t === "boolean" || val === null)
				return val;
			if (val && val.$$date) return val.$$date;
			return val;
		});
		return this.$$model.new(item);
	}

	private async $$loadFromLocal() {
		const deserialized = (await this.$$idb.values()).map((x) =>
			this.$$deserialize(x)
		) as T[];
		this.$$observableObject.silently((o) => {
			o.splice(0, o.length, ...deserialized);
		});
	}

	private async $$processChanges() {
		this.$$lastProcessChanges = Date.now();

		const toWriteLocally: [string, string][] = [];
		const toSendRemotely: { [key: string]: string } = {};
		const toDeffer: deferredArray = [];
		const changesToProcess = [...this.$$changes]; // Create a copy of changes to process

		this.$$changes = []; // Clear the original changes array

		for (let index = 0; index < changesToProcess.length; index++) {
			const change = changesToProcess[index];
			const item = change.snapshot[change.path[0] as number];
			const serializedLine = this.$$serialize(item);
			toWriteLocally.push([item.id, serializedLine]);
			toSendRemotely[item.id] = serializedLine;
			toDeffer.push({
				ts: Date.now(),
				data: serializedLine,
			});
		}

		await this.$$idb.setBulk(toWriteLocally);
		const deferred = (await this.$$idb.getMetadata("deferred")) || "[]";
		let deferredArray = JSON.parse(deferred) as deferredArray;
		if (this.isOnline && this.$$syncService && deferredArray.length === 0) {
			try {
				await this.$$syncService.sendUpdates(toSendRemotely);
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
		deferredArray = deferredArray.concat(...toDeffer);
		await this.$$idb.setMetadata("deferred", JSON.stringify(deferredArray));
		this.deferredPresent = true;
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

	private async $$localVersion() {
		return Number((await this.$$idb.getMetadata("version")) || 0);
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
	async $$syncTry(): Promise<{
		pushed?: number;
		pulled?: number;
		exception?: string;
	}> {
		if (!this.$$syncService) {
			return {
				exception: "Sync service not available",
			};
		}
		if (!this.isOnline) {
			return {
				exception: "Offline",
			};
		}
		try {
			const localVersion = await this.$$localVersion();
			const remoteVersion = await this.$$syncService.latestVersion();
			const deferred = (await this.$$idb.getMetadata("deferred")) || "[]";
			let deferredArray = JSON.parse(deferred) as deferredArray;

			if (localVersion === remoteVersion && deferredArray.length === 0) {
				return {
					exception: "Nothing to sync",
				};
			}

			// fetch updates since our local version
			const remoteUpdates = await this.$$syncService.fetchData(localVersion);

			// check for conflicts
			deferredArray = deferredArray.filter((x) => {
				let item = this.$$deserialize(x.data);
				const conflict = remoteUpdates.rows.findIndex((y) => y.id === item.id);
				if (conflict === -1) {
					return true;
				} else if (x.ts > remoteVersion) {
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
			for (const remote of remoteUpdates.rows) {
				await this.$$idb.set(remote.id, remote.data);
			}

			// then local
			const updatedRows: { [key: string]: string } = {};
			for (const local of deferredArray) {
				let item = this.$$deserialize(local.data);
				updatedRows[item.id] = local.data;
				// latest deferred write wins since it would overwrite the previous one
			}
			await this.$$syncService.sendUpdates(updatedRows);

			// reset deferred
			await this.$$idb.setMetadata("deferred", "[]");
			this.deferredPresent = false;

			// set local version
			await this.$$idb.setMetadata("version", remoteUpdates.version.toString());

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
		let tries: { exception?: string; pushed?: number; pulled?: number }[] = [];
		let exceptionOccurred = false;
		while (!exceptionOccurred) {
			const result = await this.$$syncTry();
			if (result.exception) {
				exceptionOccurred = true;
			}
			tries.push(result);
		}
		return tries;
	}

	/**
	 * Public methods, to be used by the application
	 */
	get list() {
		return this.$$observableObject.observable.filter((x) => !x.$$deleted);
	}

	getByID(id: string) {
		return this.$$observableObject.observable.find((x) => x.id === id);
	}

	add(item: T) {
		if (this.$$observableObject.observable.find((x) => x.id === item.id)) {
			throw new Error("Duplicate ID detected: " + JSON.stringify(item.id));
		}
		this.$$observableObject.observable.push(item);
	}

	delete(item: T) {
		const index = this.$$observableObject.observable.findIndex(
			(x) => x.id === item.id
		);
		if (index === -1) {
			throw new Error("Item not found.");
		}
		this.deleteByIndex(index);
	}

	deleteByIndex(index: number) {
		if (!this.$$observableObject.observable[index]) {
			throw new Error("Item not found.");
		}
		this.$$observableObject.observable[index].$$deleted = true;
	}

	deleteByID(id: string) {
		const index = this.$$observableObject.observable.findIndex(
			(x) => x.id === id
		);
		if (index === -1) {
			throw new Error("Item not found.");
		}
		this.deleteByIndex(index);
	}

	updateByIndex(index: number, item: T) {
		if (!this.$$observableObject.observable[index]) {
			throw new Error("Item not found.");
		}
		if (this.$$observableObject.observable[index].id !== item.id) {
			throw new Error("ID mismatch.");
		}
		this.$$observableObject.observable[index] = item;
	}

	sync = debounce(this.$$sync.bind(this), this.$$debounceRate);

	async isUpdated() {
		return this.$$syncService ? (await this.$$syncService.latestVersion() === await this.$$localVersion()) : true;
	}
}