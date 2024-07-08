import { Store } from "../src/store";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Miniflare } from "miniflare";
import "fake-indexeddb/auto";
import { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { readFileSync, writeFileSync } from "fs";

describe("Store", () => {
	let store: Store<{
		id: string;
		name: string;
	}>;
	const env: { DB: D1Database; CACHE: KVNamespace } = {} as any;

	const token = "token";

	beforeEach(async () => {
		store = new Store({
			name: Math.random().toString(36).substring(7),
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});

		let workerFile = readFileSync(
			"../apexo-database/dist/index.js",
			"utf-8"
		).replace(
			`var Auth = class {
  static async authenticate(token) {
    try {
      const response = await fetch("https://auth1.apexo.app", {
        method: "PUT",
        body: JSON.stringify({ operation: "jwt", token })
      });
      const result = await response.json();
      if (!result.success) {
        return { success: false };
      }
      const account = JSON.parse(atob(token)).payload.prefix;
      return { success: true, account };
    } catch (e) {
      return { success: false };
    }
  }
};`,
			`var Auth = class {
  static async authenticate(token) {
    try {
      return { success: true, account: "ali" };
    } catch (e) {
      return { success: false };
    }
  }
}`
		);

		writeFileSync("./worker.js", workerFile);

		const mf = new Miniflare({
			modules: true,
			scriptPath: `./worker.js`,
			kvNamespaces: ["CACHE"],
			d1Databases: ["DB"],
		});
		env.CACHE = (await mf.getKVNamespace("CACHE")) as any;
		env.DB = await mf.getD1Database("DB");

		await env.DB.exec(
			`CREATE TABLE staff (id TEXT PRIMARY KEY, account TEXT, data TEXT);`
		);
		await env.DB.exec(
			`CREATE TABLE staff_changes (version INTEGER, account TEXT, ids TEXT);`
		);
		global.fetch = mf.dispatchFetch as any;
	});

	it("should add an item to the store", () => {
		const item = { id: "1", name: "Test" };
		store.add(item);
		expect(!!store.list.find((x) => x.id === "1")).toBe(true);
	});

	it("should delete an item from the store", () => {
		const item = { id: "1", name: "Test" };
		store.add(item);
		store.delete(item);
		expect(!!store.list.find((x) => x.id === "1")).toBe(false);
	});

	it("should update an item in the store", () => {
		const item = { id: "1", name: "x" };
		store.add(item);
		const updatedItem = { id: "1", name: "y" };
		store.updateByIndex(0, updatedItem);
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
			store.delete(item);
		}).toThrowError("Item not found.");
	});

	it("should not update an item in the store if it does not exist", () => {
		const item = { id: "1", name: "Test" };
		store.add(item);
		expect(() => {
			store.updateByIndex(1, item);
		}).toThrowError("Item not found.");
	});

	it("should not update an item in the store if the ID is different", () => {
		const item = { id: "1", name: "Test" };
		store.add(item);
		expect(() => {
			store.updateByIndex(0, { id: "2", name: "Test" });
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
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
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

		expect(await (store as any).$$localVersion()).toBe(99);
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
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
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

		expect(await (store as any).$$localVersion()).toBe(123);

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

		expect(await (store as any).$$localVersion()).toBe(124);
	});

	it("local inserts should pushed to sync server (automatically without calling sync)", async () => {
		{
			// clearing local database before starting
			store = new Store({
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});
		await new Promise((r) => setTimeout(r, 300));

		{
			const tries = await store.sync();
			expect(tries.length).toBe(1);
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

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
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});

		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));
		store.delete({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

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
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});
		{
			const tries = await store.sync();
			expect(tries.length).toBe(1);
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));
		store.updateByIndex(0, { id: "1", name: "john" });
		await new Promise((r) => setTimeout(r, 300));

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
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
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
		expect(await (store as any).$$localVersion()).toBe(version);
	});

	it("should pull updated from remote", async () => {
		{
			// clearing local database before starting
			store = new Store({
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});
		{
			const tries = await store.sync();
			expect(tries.length).toBe(1);
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

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
		expect(await (store as any).$$localVersion()).toBe(version);
	});

	it("should pull deleted from remote", async () => {
		{
			// clearing local database before starting
			store = new Store({
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});

		{
			const tries = await store.sync();
			expect(tries.length).toBe(1);
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

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

		expect((store as any).$$observableObject.observable.length).toBe(1);
		expect(store.list.length).toBe(0);
		expect(await (store as any).$$localVersion()).toBe(version);
	});

	it("should send deferred changes", async () => {
		{
			// clearing local database before starting
			store = new Store({
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

		store.isOnline = false;
		store.add({ id: "2", name: "john" });
		await new Promise((r) => setTimeout(r, 300));

		expect(store.list.length).toBe(2);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Offline");
		}

		await new Promise((r) => setTimeout(r, 300));

		expect(store.list.length).toBe(2);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		store.isOnline = true;

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
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

		store.isOnline = false;
		store.updateByIndex(0, { id: "1", name: "john" });
		await new Promise((r) => setTimeout(r, 300));

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

		await new Promise((r) => setTimeout(r, 300));

		expect(store.list.length).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"alex"}');

		store.isOnline = true;

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
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[1].exception).toBe("Nothing to sync");
		}
	});

	it("should not sync if not online", async () => {
		store.isOnline = false;
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Offline");
		}
	});

	it("should not sync if sync service is not available", async () => {
		(store as any).$$syncService = null;
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Sync service not available");
		}
	});

	it("should sync push (deferred) and pull at the same time", async () => {
		{
			// clearing local database before starting
			store = new Store({
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
			debounceRate: 1,
		});
		store.add({ id: "0", name: "ali" });
		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		store.isOnline = false;
		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

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

		store.isOnline = true;
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
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});
		store.add({ id: "0", name: "ali" });
		{
			const tries = await store.sync();
			expect(tries.length).toBe(2);
			expect(tries[0].pulled).toBe(1);
			expect(tries[1].exception).toBe("Nothing to sync");
		}

		store.isOnline = false;
		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

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

		store.isOnline = true;
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
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
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
		await new Promise((r) => setTimeout(r, 300));

		store.isOnline = false;

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
		store.isOnline = false;
		// this is more recent
		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));
		store.isOnline = true;

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
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});

		expect(await (store as any).$$localVersion()).toBe(0);
		expect(await (store as any).$$syncService.latestVersion()).toBe(0);
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}
		expect(await (store as any).$$localVersion()).toBe(0);
		expect(await (store as any).$$syncService.latestVersion()).toBe(0);
	});

	it("Debounce rate affect process changes A", async () => {
		{
			// clearing local database before starting
			store = new Store({
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}

		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
			debounceRate: 1000,
		});

		store.add({ id: "0", name: "ali" });
		await new Promise((r) => setTimeout(r, 100));
		store.add({ id: "1", name: "alex" });
		expect((await (store as any).$$idb.values()).length).toBe(1); // 1
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 2
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 3
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 4
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 5
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 6
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 7
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 8
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 9
		await new Promise((r) => setTimeout(r, 150));
		expect((await (store as any).$$idb.values()).length).toBe(2); // 10.5
	});

	it("Debounce rate affect process changes B", async () => {
		{
			// clearing local database before starting
			store = new Store({
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}

		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
			debounceRate: 500,
		});

		store.add({ id: "0", name: "ali" });
		await new Promise((r) => setTimeout(r, 100));
		store.add({ id: "1", name: "alex" });
		expect((await (store as any).$$idb.values()).length).toBe(1); // 1
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 2
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 3
		await new Promise((r) => setTimeout(r, 100));
		expect((await (store as any).$$idb.values()).length).toBe(1); // 4
		await new Promise((r) => setTimeout(r, 150));
		expect((await (store as any).$$idb.values()).length).toBe(2); // 5.5
	});

	it("Deferred changes must pushes only the latest change", async () => {
		{
			// clearing local database before starting
			store = new Store({
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

		store.isOnline = false;
		store.updateByIndex(0, { id: "1", name: "john" });
		await new Promise((r) => setTimeout(r, 300));

		store.updateByIndex(0, { id: "1", name: "mark" });
		await new Promise((r) => setTimeout(r, 300));

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

		await new Promise((r) => setTimeout(r, 300));

		expect(store.list.length).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"alex"}');

		store.isOnline = true;

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
				name: "staff",
				token: token,
				persist: true,
				endpoint: "http://example.com",
			});
			await (store as any).$$idb.clear();
			await (store as any).$$idb.clearMetadata();
		}
		store = new Store({
			name: "staff",
			token: token,
			persist: true,
			endpoint: "http://example.com",
		});
		{
			const tries = await store.sync();
			expect(tries[0].exception).toBe("Nothing to sync");
		}

		store.add({ id: "1", name: "alex" });
		await new Promise((r) => setTimeout(r, 300));

		store.isOnline = false;
		store.updateByIndex(0, { id: "1", name: "john" });
		await new Promise((r) => setTimeout(r, 300));

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

		await new Promise((r) => setTimeout(r, 300));

		expect(store.list.length).toBe(1);
		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results.length
		).toBe(1);

		expect(
			(await env.DB.prepare("SELECT * FROM staff").all()).results[0].data
		).toBe('{"id":"1","name":"alex"}');

		store.isOnline = true;

		store.updateByIndex(0, { id: "1", name: "mark" });
		await new Promise((r) => setTimeout(r, 300));

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
});
