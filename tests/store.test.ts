import { Store } from "../src/store";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Miniflare } from "miniflare";
import { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { readFileSync, writeFileSync } from "fs";
import { IDB } from "../src/persistence/local";
import { CloudFlareApexoDB } from "../src/persistence/remote";
import "fake-indexeddb/auto";

describe("Store", () => {
	let store: Store<{
		id: string;
		name: string;
	}>;
	const env: { DB: D1Database; CACHE: KVNamespace } = {} as any;

	const token = "token";
	let mf: Miniflare;

	beforeEach(async () => {
		store = new Store({});

		let workerFile = readFileSync(
			"../apexo-database/dist/index.js",
			"utf-8"
		).replace(
			/const response(.|\n)*return \{ success: true, account \};/,
			`return {success: true, account: "ali"}`
		);
		writeFileSync("./worker.js", workerFile);

		mf = new Miniflare({
			modules: true,
			scriptPath: `./worker.js`,
			kvNamespaces: ["CACHE"],
			d1Databases: ["DB"],
		});
		env.CACHE = (await mf.getKVNamespace("CACHE")) as any;
		env.DB = await mf.getD1Database("DB");
		global.fetch = mf.dispatchFetch as any;

		await env.DB.exec(
			`CREATE TABLE staff (id TEXT PRIMARY KEY, account TEXT, data TEXT);`
		);
		await env.DB.exec(
			`CREATE TABLE staff_changes (version INTEGER, account TEXT, ids TEXT);`
		);
	});

	it("should add an item to the store", () => {
		const item = { id: "1", name: "Test" };
		store.add(item);
		expect(!!store.list.find((x) => x.id === "1")).toBe(true);
	});

	it("should delete an item from the store", () => {
		const item = { id: "1", name: "Test" };
		store.add(item);
		store.delete(item.id);
		expect(!!store.list.find((x) => x.id === "1")).toBe(false);
	});

	it("should update an item in the store", () => {
		const item = { id: "1", name: "x" };
		store.add(item);
		const updatedItem = { id: "1", name: "y" };
		store.update(updatedItem.id, updatedItem);
		expect(!!store.list.find((x) => x.name === "x")).toBe(false);
		expect(!!store.list.find((x) => x.name === "y")).toBe(true);
	});

	it("should not add an item to the store if it already exists", () => {
		const item = { id: "1", name: "Test" };
		store.add(item);
		expect(() => {
			store.add(item);
		}).toThrowError("Duplicate ID detected: " + JSON.stringify(item.id));
	});

	it("should not delete an item from the store if it does not exist", () => {
		const item = { id: "1", name: "Test" };
		expect(() => {
			store.delete(item.id);
		}).toThrowError("Item not found.");
	});

	it("should not update an item in the store if it does not exist", () => {
		const item = { id: "1", name: "Test" };
		store.add(item);
		expect(() => {
			store.update("x", item);
		}).toThrowError("Item not found.");
	});

	it("should not update an item in the store if the ID is different", () => {
		const item = { id: "1", name: "Test" };
		store.add(item);
		expect(() => {
			store.update(item.id, { id: "2", name: "Test" });
		}).toThrowError("ID mismatch.");
	});

	it("should sync with the remote store (initially)", async () => {
		// writing to remote database
		await env.DB.exec(
			'INSERT INTO staff (id, account, data) VALUES (\'1\', \'ali\', \'{"id":"1","name":"alex"}\');'
		);
		await env.DB.exec(
			'INSERT INTO staff (id, account, data) VALUES (\'2\', \'ali\', \'{"id":"2","name":"john"}\');'
		);
		await env.DB.exec(
			"INSERT INTO staff_changes (version, account, ids) VALUES (99, 'ali', '1,2');"
		);

		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});

		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(2);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		expect(JSON.parse(JSON.stringify(store.list))).toEqual([
			{ id: "1", name: "alex" },
			{ id: "2", name: "john" },
		]);

		expect(await (store as any).$$localPersistence.getVersion()).toBe(99);
	});

	it("should sync with the remote store (after initial sync) i.e. pulling", async () => {
		await env.DB.exec(
			'INSERT INTO staff (id, account, data) VALUES (\'1\', \'ali\', \'{"id":"1","name":"alex"}\');'
		);
		await env.DB.exec(
			'INSERT INTO staff (id, account, data) VALUES (\'2\', \'ali\', \'{"id":"2","name":"john"}\');'
		);
		await env.DB.exec(
			"INSERT INTO staff_changes (version, account, ids) VALUES (123, 'ali', '1,2');"
		);

		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});

		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(2);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		expect(JSON.parse(JSON.stringify(store.list))).toEqual([
			{ id: "1", name: "alex" },
			{ id: "2", name: "john" },
		]);

		expect(await (store as any).$$localPersistence.getVersion()).toBe(123);

		await env.DB.prepare(
			'INSERT INTO staff (id, account, data) VALUES (\'3\', \'ali\', \'{"id":"3","name":"mohammed"}\');'
		).run();
		await env.DB.prepare(
			"INSERT INTO staff_changes (version, account, ids) VALUES (124, 'ali', '3');"
		).run();

		// empty the cache
		const keys = (await env.CACHE.list()).keys.map((x) => x.name);
		for (let index = 0; index < keys.length; index++) {
			const element = keys[index];
			await env.CACHE.delete(element);
		}

		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		expect(JSON.parse(JSON.stringify(store.list))).toEqual([
			{ id: "1", name: "alex" },
			{ id: "2", name: "john" },
			{ id: "3", name: "mohammed" },
		]);

		expect(await (store as any).$$localPersistence.getVersion()).toBe(124);
	});

	it("local inserts should pushed to sync server (automatically without calling sync)", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		await new Promise((r) => setTimeout(r, 150));

		{
			const tries = await store.sync();
			expect(tries.length).toBe(1);
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));

		const rows = (await env.DB.prepare("SELECT * FROM staff").all()).results;
		expect(rows[0].data).toBe('{"id":"1","name":"alex"}');

		const changes = (await env.DB.prepare("SELECT * FROM staff_changes").all())
			.results;
		expect(changes[0].ids).toBe("1");
		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}
	});

	it("local deletes should pushed to sync server", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});

		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));
		store.delete("1");
		await new Promise((r) => setTimeout(r, 150));

		const rows = (await env.DB.prepare("SELECT * FROM staff").all()).results;
		expect(rows.length).toBe(1);
		expect(rows[0].data).toBe('{"id":"1","name":"alex","$$deleted":true}');
		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}
	});

	it("local updates should pushed to sync server", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries.length).toBe(1);
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));
		store.update("1", { id: "1", name: "john" });
		await new Promise((r) => setTimeout(r, 150));

		const rows = (await env.DB.prepare("SELECT * FROM staff").all()).results;
		expect(rows.length).toBe(1);
		expect(rows[0].data).toBe('{"id":"1","name":"john"}');
		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}
	});

	it("should pull from remote server", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});

		const version = Number(
			(
				await (
					await fetch("https://apexo.app/staff", {
						method: "PUT",
						headers: {
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({
							"12": '{"id":"12","name":"alex"}',
						}),
					})
				).json()
			).output
		);

		const remote = (await env.DB.prepare(`SELECT * FROM staff`).all()).results;

		expect(store.list.length).toBe(0); // before sync

		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		expect(store.list.length).toBe(1);
		expect(store.list[0].id).toBe("12");
		expect(await (store as any).$$localPersistence.getVersion()).toBe(version);
	});

	it("should pull updated from remote", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries.length).toBe(1);
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));

		const version = Number(
			(
				await (
					await fetch("https://apexo.app/staff", {
						method: "PUT",
						headers: {
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({
							"1": '{"id":"1","name":"alex2"}',
						}),
					})
				).json()
			).output
		);

		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		expect(store.list.length).toBe(1);
		expect(store.list[0].id).toBe("1");
		expect(store.list[0].name).toBe("alex2");
		expect(await (store as any).$$localPersistence.getVersion()).toBe(version);
	});

	it("should pull deleted from remote", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});

		{
			const tries = await store.sync();
			expect(tries.length).toBe(1);
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));

		const version = Number(
			(
				await (
					await fetch("https://apexo.app/staff", {
						method: "PUT",
						headers: {
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({
							"1": '{"id":"1","name":"alex1","$$deleted":true}',
						}),
					})
				).json()
			).output
		);

		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		expect((store as any).$$observableObject.target.length).toBe(1);
		expect(store.list.length).toBe(0);
		expect(await (store as any).$$localPersistence.getVersion()).toBe(version);
	});

	it("should send deferred changes", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));

		global.fetch = () => {
			throw new Error("Mock connectivity error");
		};
		store.add({ id: "2", name: "john" });
		await new Promise((r) => setTimeout(r, 150));

		expect(store.list.length).toBe(2);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Offline");
		}

		await new Promise((r) => setTimeout(r, 150));

		expect(store.list.length).toBe(2);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		global.fetch = mf.dispatchFetch as any;
		(store as any).$$remotePersistence.isOnline = true;

		{
			const tries = await store.sync(); // now it should send the deferred changes
			expect(tries.length).toBe(3);
			expect(tries[0].pushed).toBe(1);
			expect(tries[0].pulled).toBe(1);
			expect(tries[1].pushed).toBe(0);
			expect(tries[1].pulled).toBe(1); // the same one we pushed, but we need to pull it to get the correct version
			expect(tries[2].exception).toBe("Nothing to sync");
		}

		expect(store.list.length).toBe(2);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(2);
	});

	it("should send deferred changes (update)", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));

		global.fetch = () => {
			throw new Error("Mock connectivity error");
		};
		store.update("1", { id: "1", name: "john" });
		await new Promise((r) => setTimeout(r, 150));

		expect(store.list.length).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"alex"}');

		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Offline");
		}

		await new Promise((r) => setTimeout(r, 150));

		expect(store.list.length).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"alex"}');

		global.fetch = mf.dispatchFetch as any;
		(store as any).$$remotePersistence.isOnline = true;

		{
			const tries = await store.sync(); // now it should send the deferred changes
			expect(tries.length).toBe(3);
			expect(tries[0].pushed).toBe(1);
			expect(tries[0].pulled).toBe(0);
			expect(tries[1].pushed).toBe(0);
			expect(tries[1].pulled).toBe(1); // the same one we pushed, but we need to pull it to get the correct version
			expect(tries[2].exception).toBe("Nothing to sync");
		}

		expect(store.list.length).toBe(1);
		expect(store.list[0].name).toBe("john");
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"john"}');
	});

	it("should not send deferred changes if there are none", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));

		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[1].exception).toBe("Nothing to sync");
		}
	});

	it("should not sync if not online", async () => {
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				endpoint: "https://apexo-database.vercel.app",
				token: "any",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		global.fetch = () => {
			throw new Error("Mock connectivity error");
		};
		await store.sync();
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Offline");
		}
	});

	it("should not sync if local persistence is not available", async () => {
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				endpoint: "https://apexo-database.vercel.app",
				token: "any",
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Local persistence not available");
		}
	});

	it("should not sync if remote persistence is not available", async () => {
		store = new Store({
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Remote persistence not available");
		}
	});

	it("should sync push (deferred) and pull at the same time", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
			debounceRate: 1,
		});
		store.add({ id: "0", name: "ali" });
		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		global.fetch = () => {
			throw new Error("Mock connectivity error");
		};
		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));

		global.fetch = mf.dispatchFetch as any;
		(store as any).$$remotePersistence.isOnline = true;
		
		const version = Number(
			(
				await (
					await fetch("https://apexo.app/staff", {
						method: "PUT",
						headers: {
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({
							"2": '{"id":"2","name":"john"}',
						}),
					})
				).json()
			).output
		);

		{
			const tries = await store.sync();
			expect(tries.length).toBe(3);
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(1);
			expect(tries[1].pulled).toBe(1); // the same one we pushed
			expect(tries[1].pushed).toBe(0);
			expect(tries[2].exception).toBe("Nothing to sync");
		}
		expect(store.list.length).toBe(3);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(3);
	});

	it("should resolve conflicts based on timestamp comparison", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		store.add({ id: "0", name: "ali" });
		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		global.fetch = () => {
			throw new Error("Mock connectivity error");
		};
		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));
		global.fetch = mf.dispatchFetch as any;
		(store as any).$$remotePersistence.isOnline = true;
		// this is more recent
		const version = Number(
			(
				await (
					await fetch("https://apexo.app/staff", {
						method: "PUT",
						headers: {
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({
							"1": '{"id":"1","name":"john"}',
						}),
					})
				).json()
			).output
		);

		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}
		expect(store.list.length).toBe(2);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(2);
		expect(store.list[1].name).toBe("john");
	});

	it("should resolve conflicts based on timestamp comparison (reversed)", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}
		store.add({ id: "0", name: "ali" });
		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[1].exception).toBe("Nothing to sync");
		}
		await new Promise((r) => setTimeout(r, 150));

		global.fetch = mf.dispatchFetch as any;
		(store as any).$$remotePersistence.isOnline = true;
		
		const version = Number(
			(
				await (
					await fetch("https://apexo.app/staff", {
						method: "PUT",
						headers: {
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({
							"1": '{"id":"1","name":"john"}',
						}),
					})
				).json()
			).output
		);
		await new Promise((r) => setTimeout(r, 1300));
		global.fetch = () => {
			throw new Error("Mock connectivity error");
		};
		// this is more recent
		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));
		global.fetch = mf.dispatchFetch as any;
		(store as any).$$remotePersistence.isOnline = true;
		{
			const tries = await store.sync();
			expect(tries.length).toBe(3);
			expect(tries[0].pulled).toBe(0);
			expect(tries[0].pushed).toBe(1);
			expect(tries[1].pulled).toBe(1);
			expect(tries[1].pushed).toBe(0);
			expect(tries[2].exception).toBe("Nothing to sync");
		}
		expect(store.list.length).toBe(2);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(2);
		expect(store.list[1].name).toBe("alex");
	});

	it("When everything is empty", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});

		expect(await (store as any).$$localPersistence.getVersion()).toBe(0);
		expect(await (store as any).$$remotePersistence.getVersion()).toBe(0);
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}
		expect(await (store as any).$$localPersistence.getVersion()).toBe(0);
		expect(await (store as any).$$remotePersistence.getVersion()).toBe(0);
	});

	it("Debounce rate affect process changes A", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}

		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
			debounceRate: 1000,
		});

		store.add({ id: "0", name: "ali" });
		await new Promise((r) => setTimeout(r, 100));
		store.add({ id: "1", name: "alex" });
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 1
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 2
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 3
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 4
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 5
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 6
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 7
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 8
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 9
		await new Promise((r) => setTimeout(r, 150));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(2); // 10.5
	});

	it("Debounce rate affect process changes B", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}

		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
			debounceRate: 500,
		});

		store.add({ id: "0", name: "ali" });
		await new Promise((r) => setTimeout(r, 100));
		store.add({ id: "1", name: "alex" });
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 1
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 2
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 3
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(1); // 4
		await new Promise((r) => setTimeout(r, 150));
		expect((await (store as any).$$localPersistence.getAll()).length).toBe(2); // 5.5
	});

	it("Deferred changes must pushes only the latest change", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));

		global.fetch = () => {
			throw new Error("Mock connectivity error");
		};
		store.update("1", { id: "1", name: "john" });
		await new Promise((r) => setTimeout(r, 150));

		store.update("1", { id: "1", name: "mark" });
		await new Promise((r) => setTimeout(r, 150));

		expect(store.list.length).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"alex"}');

		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Offline");
		}

		await new Promise((r) => setTimeout(r, 150));

		expect(store.list.length).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"alex"}');

		global.fetch = mf.dispatchFetch as any;
		(store as any).$$remotePersistence.isOnline = true;
		{
			const tries = await store.sync(); // now it should send the deferred changes
			expect(tries.length).toBe(3);
			expect(tries[0].pushed).toBe(2); // two changes in deferred array, but only the latest would be pushed (on the same ID)
			expect(tries[0].pulled).toBe(0);
			expect(tries[1].pushed).toBe(0);
			expect(tries[1].pulled).toBe(1); // the same one we pushed, but we need to pull it to get the correct version
			expect(tries[2].exception).toBe("Nothing to sync");
		}

		expect(store.list.length).toBe(1);
		expect(store.list[0].name).toBe("mark");
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"mark"}');
	});

	it("If there are already deferred changes, no updates shall be sent unless there's a sync process", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));

		global.fetch = () => {
			throw new Error("Mock connectivity error");
		};
		store.update("1", { id: "1", name: "john" });
		await new Promise((r) => setTimeout(r, 150));

		expect(store.list.length).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"alex"}');

		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Offline");
		}

		await new Promise((r) => setTimeout(r, 150));

		expect(store.list.length).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"alex"}');

		global.fetch = mf.dispatchFetch as any;
		(store as any).$$remotePersistence.isOnline = true;

		store.update("1", { id: "1", name: "mark" });
		await new Promise((r) => setTimeout(r, 150));

		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"alex"}');

		{
			const tries = await store.sync(); // now it should send the deferred changes
			expect(tries.length).toBe(3);
			expect(tries[0].pushed).toBe(2); // two changes in deferred array, but only the latest would be pushed (on the same ID)
			expect(tries[0].pulled).toBe(0);
			expect(tries[1].pushed).toBe(0);
			expect(tries[1].pulled).toBe(1); // the same one we pushed, but we need to pull it to get the correct version
			expect(tries[2].exception).toBe("Nothing to sync");
		}

		expect(store.list.length).toBe(1);
		expect(store.list[0].name).toBe("mark");
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"mark"}');
	});

	it("Rely on the specific version of the row when it is available", async () => {
		{
			// clearing local database before starting
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			await (store as any).$$localPersistence.clear();
			await (store as any).$$localPersistence.clearMetadata();
		}
		store = new Store({
			remotePersistence: new CloudFlareApexoDB({
				token,
				endpoint: "https://apexo-database.vercel.app",
				name: "staff",
			}),
			localPersistence: new IDB({
				name: "staff",
			}),
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 150));

		{
			const tries = await store.sync();
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(0);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		global.fetch = () => {
			throw new Error("Mock connectivity error");
		};
		store.update("1", { id: "1", name: "mathew" });
		await new Promise((r) => setTimeout(r, 150));

		expect(store.deferredPresent).toBe(true);

		await env.DB.exec(
			`UPDATE staff SET data = '{"id":"1","name":"john"}' WHERE id = 1`
		);
		await env.DB.exec(
			'INSERT INTO staff (id, account, data) VALUES (\'2\', \'ali\', \'{"id":"2","name":"ron"}\');'
		);
		const deferredVersion = Number(
			JSON.parse(
				await (store as any).$$localPersistence.getMetadata("deferred")
			)[0].ts
		);
		const localVersion = Number(
			await (store as any).$$localPersistence.getVersion()
		);
		expect(deferredVersion).toBeGreaterThan(localVersion);
		const remoteConflictVersion = (deferredVersion + localVersion) / 2;

		await env.DB.exec(
			`INSERT INTO staff_changes (version, account, ids) VALUES (${remoteConflictVersion}, 'ali', '1');`
		);
		await env.DB.exec(
			`INSERT INTO staff_changes (version, account, ids) VALUES (${
				deferredVersion + 1000
			}, 'ali', '2');`
		);

		global.fetch = mf.dispatchFetch as any;
		(store as any).$$remotePersistence.isOnline = true;

		const keys = (await env.CACHE.list()).keys.map((x) => x.name);
		for (let index = 0; index < keys.length; index++) {
			const element = keys[index];
			await env.CACHE.delete(element);
		}

		{
			const tries = await store.sync();
			expect(tries[0].pulled).toBe(1);
			expect(tries[0].pushed).toBe(1); // deferred won
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		expect(JSON.stringify(store.list)).toBe(
			`[{"id":"1","name":"mathew"},{"id":"2","name":"ron"}]`
		);
	});
	describe("Backup and restore", () => {
		it("should throw an error when local persistence is not available", async () => {
			{
				// clearing local database before starting
				store = new Store({
					remotePersistence: new CloudFlareApexoDB({
						token,
						endpoint: "https://apexo-database.vercel.app",
						name: "staff",
					}),
					localPersistence: new IDB({
						name: "staff",
					}),
				});
				await (store as any).$$localPersistence.clear();
				await (store as any).$$localPersistence.clearMetadata();
			}
			store = new Store<{ name: string; id: string }>({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
			});
			(store as any).$$localPersistence = undefined;
			await expect(() => store.backup()).rejects.toThrow(
				"Local persistence not available"
			);
		});

		it("should return a JSON string of the local persistence dump", async () => {
			{
				// clearing local database before starting
				store = new Store({
					remotePersistence: new CloudFlareApexoDB({
						token,
						endpoint: "https://apexo-database.vercel.app",
						name: "staff",
					}),
					localPersistence: new IDB({
						name: "staff",
					}),
				});
				await (store as any).$$localPersistence.clear();
				await (store as any).$$localPersistence.clearMetadata();
			}
			store = new Store<{ name: string; id: string }>({
				localPersistence: new IDB({
					name: "staff",
				}),
			});
			expect(await store.backup()).toBe(
				`{"data":[],"metadata":{"version":0,"deferred":[]}}`
			);
			store.add({ id: "1", name: "alex" });
			store.add({ id: "2", name: "mark" });

			await new Promise((r) => setTimeout(r, 150));

			expect(await store.backup()).toBe(
				JSON.stringify({
					data: [
						["1", '{"id":"1","name":"alex"}'],
						["2", '{"id":"2","name":"mark"}'],
					],
					metadata: {
						version: 0,
						deferred: [],
					},
				})
			);
		});

		it("deferred updates should be present on backup dump", async () => {
			{
				// clearing local database before starting
				store = new Store({
					remotePersistence: new CloudFlareApexoDB({
						token,
						endpoint: "https://apexo-database.vercel.app",
						name: "staff",
					}),
					localPersistence: new IDB({
						name: "staff",
					}),
				});
				await (store as any).$$localPersistence.clear();
				await (store as any).$$localPersistence.clearMetadata();
			}
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});

			store.add({ id: "0", name: "ali" });
			await new Promise((r) => setTimeout(r, 100));
			global.fetch = () => {
				throw new Error("Mock connectivity error");
			};

			store.add({ id: "1", name: "alex" });
			store.add({ id: "2", name: "mark" });
			await new Promise((r) => setTimeout(r, 100));

			const backup = JSON.parse(await store.backup());

			expect(backup.data.length).toBe(3);
			expect(backup.data[0][0]).toBe("0");
			expect(backup.data[1][0]).toBe("1");
			expect(backup.data[2][0]).toBe("2");

			expect(backup.metadata.deferred.length).toBe(2);
			expect(backup.metadata.deferred[0].id).toBe("1");
			expect(backup.metadata.deferred[1].id).toBe("2");
		});

		it("should restore the local persistence from a JSON string", async () => {
			{
				// clearing local database before starting
				store = new Store({
					remotePersistence: new CloudFlareApexoDB({
						token,
						endpoint: "https://apexo-database.vercel.app",
						name: "staff",
					}),
					localPersistence: new IDB({
						name: "staff",
					}),
				});
				await (store as any).$$localPersistence.clear();
				await (store as any).$$localPersistence.clearMetadata();
			}
			store = new Store<{ name: string; id: string }>({
				localPersistence: new IDB({
					name: "staff",
				}),
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
			});

			await store.loaded;

			store.add({ id: "1", name: "alex" });
			store.add({ id: "2", name: "mark" });
			await new Promise((r) => setTimeout(r, 150));

			const backup = await store.backup();

			store.update("1", { name: "mathew", id: "1" });
			store.update("2", { name: "ron", id: "2" });
			await new Promise((r) => setTimeout(r, 150));

			expect(store.copy).toEqual([
				{ id: "1", name: "mathew" },
				{ id: "2", name: "ron" },
			]);

			await store.restoreBackup(backup);
			await new Promise((r) => setTimeout(r, 150));

			expect(store.copy).toEqual([
				{ id: "1", name: "alex" },
				{ id: "2", name: "mark" },
			]);
		});

		it("should restore deferred", async () => {
			{
				// clearing local database before starting
				store = new Store({
					remotePersistence: new CloudFlareApexoDB({
						token,
						endpoint: "https://apexo-database.vercel.app",
						name: "staff",
					}),
					localPersistence: new IDB({
						name: "staff",
					}),
				});
				await (store as any).$$localPersistence.clear();
				await (store as any).$$localPersistence.clearMetadata();
			}
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});

			await store.loaded;

			store.add({ id: "1", name: "alex" });
			store.add({ id: "2", name: "mark" });
			await new Promise((r) => setTimeout(r, 100));

			global.fetch = () => {
				throw new Error("Mock connectivity error");
			};
			await new Promise((r) => setTimeout(r, 100));

			store.update("1", { name: "mathew", id: "1" });
			store.update("2", { name: "ron", id: "2" });
			await new Promise((r) => setTimeout(r, 100));
			expect(store.copy).toEqual([
				{ id: "1", name: "mathew" },
				{ id: "2", name: "ron" },
			]);
			const deferred = await (store as any).$$localPersistence?.getDeferred();
			expect(store.deferredPresent).toBe(true);
			const backup = await store.backup();
			global.fetch = mf.dispatchFetch as any;
			(store as any).$$remotePersistence.isOnline = true;

			await store.sync();
			await new Promise((r) => setTimeout(r, 100));

			expect(await (store as any).$$localPersistence?.getDeferred()).toEqual(
				[]
			);

			global.fetch = () => {
				throw new Error("Mock connectivity error");
			};
			await expect(async () => await store.restoreBackup(backup)).to.rejects.toThrow();

			global.fetch = mf.dispatchFetch as any;
			const sync = await store.restoreBackup(backup);
			expect(sync.length).toBe(2);
			expect(sync[0].conflicts).toBe(2);
		});

		it("should restore and process deferred", async () => {
			{
				// clearing local database before starting
				store = new Store({
					remotePersistence: new CloudFlareApexoDB({
						token,
						endpoint: "https://apexo-database.vercel.app",
						name: "staff",
					}),
					localPersistence: new IDB({
						name: "staff",
					}),
				});
				await (store as any).$$localPersistence.clear();
				await (store as any).$$localPersistence.clearMetadata();
			}
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});

			await store.loaded;

			store.add({ id: "1", name: "alex" });
			store.add({ id: "2", name: "mark" });
			await new Promise((r) => setTimeout(r, 100));

			global.fetch = () => {
				throw new Error("Mock connectivity error");
			};
			await new Promise((r) => setTimeout(r, 100));

			store.update("1", { name: "mathew", id: "1" });
			store.update("2", { name: "ron", id: "2" });

			await new Promise((r) => setTimeout(r, 100));
			expect(store.copy).toEqual([
				{ id: "1", name: "mathew" },
				{ id: "2", name: "ron" },
			]);
			const deferred = await (store as any).$$localPersistence?.getDeferred();
			expect(store.deferredPresent).toBe(true);

			const backup = await store.backup();

			global.fetch = mf.dispatchFetch as any;
			(store as any).$$remotePersistence.isOnline = true;

			await store.sync();
			await new Promise((r) => setTimeout(r, 100));

			expect(await (store as any).$$localPersistence?.getDeferred()).toEqual(
				[]
			);

			await store.restoreBackup(backup);
			await new Promise((r) => setTimeout(r, 100));
			expect(await (store as any).$$localPersistence?.getDeferred()).toEqual(
				[]
			);
		});

		it("should get a new version after restore is completed", async () => {
			{
				// clearing local database before starting
				store = new Store({
					remotePersistence: new CloudFlareApexoDB({
						token,
						endpoint: "https://apexo-database.vercel.app",
						name: "staff",
					}),
					localPersistence: new IDB({
						name: "staff",
					}),
				});
				await (store as any).$$localPersistence.clear();
				await (store as any).$$localPersistence.clearMetadata();
			}
			store = new Store({
				remotePersistence: new CloudFlareApexoDB({
					token,
					endpoint: "https://apexo-database.vercel.app",
					name: "staff",
				}),
				localPersistence: new IDB({
					name: "staff",
				}),
			});

			await store.loaded;

			store.add({ id: "1", name: "alex" });
			store.add({ id: "2", name: "mark" });
			await new Promise((r) => setTimeout(r, 100));

			await store.sync();
			const version1 = await (store as any).$$localPersistence?.getVersion();
			const version2 = await (store as any).$$remotePersistence?.getVersion();

			expect(version1).toBe(version2);

			const backup = await store.backup();
			await store.restoreBackup(backup);
			const version3 = await (store as any).$$localPersistence?.getVersion();
			const version4 = await (store as any).$$remotePersistence?.getVersion();
			expect(version3).toBe(version4);

			expect(version3).greaterThan(version1);
		});
	});
});
