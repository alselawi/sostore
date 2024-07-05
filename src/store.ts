import { observable, ObservableArray } from "./observable";
import { IDB } from "./idb";
import { SyncService } from "./sync";

export class Model {
	id: string = Math.random().toString(36).substring(2, 9);
	$$deleted = false;
}

export type Line = {
	id: string;
	data: string;
};

export type deferredArray = { ts: number; data: Line }[];

export class Store<T extends Model> {
	public isOnline = true;

	private idb: IDB;
	private observableObject: ObservableArray<T[]> = observable([] as T[]);

	private token: string;
	private syncService: SyncService<T> | null = null;

	constructor({
		name,
		token,
		persist = true,
	}: {
		name: string;
		token: string;
		persist?: boolean;
	}) {
		this.idb = new IDB(name);
		this.token = token;
		if (persist) {
			this.loadFromLocal();
			this.setupObservers();
			this.syncService = new SyncService(
				"https://sync.apexo.app",
				this.token,
				name
			);
		}
	}

	private async loadFromLocal() {
		const deserialized = (await this.idb.values()).map((x) =>
			JSON.parse(x)
		) as T[];
		this.observableObject.silently((o) => {
			o.splice(0, o.length, ...deserialized);
		});
	}

	private setupObservers() {
		this.observableObject.observe(async (changes) => {
			for (const change of changes) {
				if (change.type === "insert" || change.type === "update") {
					const item = change.snapshot[change.path[0] as number];
					const line: Line = {
						id: item.id,
						data: JSON.stringify(item),
					};
					const serializedLine = JSON.stringify(line);
					await this.idb.set(item.id, serializedLine);

					if (this.isOnline) {
						const updateObj: { [key: string]: string } = {};
						updateObj[item.id] = serializedLine;
						await this.syncService?.sendUpdates(updateObj);
					} else {
						const deferred = (await this.idb.getMetadata("deferred")) || "[]";
						const deferredArray = JSON.parse(deferred) as deferredArray;
						deferredArray.push({
							ts: Date.now(),
							data: line,
						});

						await this.idb.setMetadata(
							"deferred",
							JSON.stringify(deferredArray)
						);
					}
				}
			}
		});
	}

	private async localVersion() {
		return Number(await this.idb.getMetadata("version"));
	}

	get list() {
		return this.observableObject.observable.filter(
			(x) => x.$$deleted === false
		);
	}

	add(item: T) {
		if (this.observableObject.observable.find((x) => x.id === item.id)) {
			throw new Error("Duplicate ID detected.");
		}
		this.observableObject.observable.push(item);
	}

	delete(item: T) {
		const index = this.observableObject.observable.findIndex(
			(x) => x.id === item.id
		);
		this.observableObject.observable[index].$$deleted = true;
	}

	update(index: number, item: T) {
		this.observableObject.observable[index] = item;
	}

	async sync() {
		if (!this.syncService) return;
		const localVersion = await this.localVersion();
		if (!localVersion) {
			// never synced with remote
			const { version, rows } = await this.syncService.fetchData();
			for (const row of rows) {
				await this.idb.set(row.id, row.data);
			}
			await this.idb.setMetadata("version", version.toString());
			await this.loadFromLocal();
			return;
		}

		const remoteVersion = await this.syncService.latestVersion();
		if (localVersion === remoteVersion) {
			return;
		}

		const deferred = (await this.idb.getMetadata("deferred")) || "[]";
		let deferredArray = JSON.parse(deferred) as deferredArray;

		const remoteUpdates = await this.syncService.fetchData(localVersion);

		// check for conflicts
		deferredArray = deferredArray.filter((x) => {
			const conflict = remoteUpdates.rows.findIndex((y) => y.id === x.data.id);
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
			await this.idb.set(remote.id, remote.data);
		}

		// then remote
		const updatedRows: { [key: string]: string } = {};
		for (const local of deferredArray) {
			updatedRows[local.data.id] = local.data.data;
		}
		await this.syncService.sendUpdates(updatedRows);

		// sync version
		await this.idb.setMetadata(
			"version",
			(await this.syncService.latestVersion()).toString()
		);

		// finally re-load local data
		await this.loadFromLocal();
	}
}
