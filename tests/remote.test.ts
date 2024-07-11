import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { Miniflare } from "miniflare";
import "fake-indexeddb/auto";
import { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { readFileSync, writeFileSync } from "fs";
import {
	CloudFlareApexoDB,
	RemotePersistence,
} from "../src/persistence/remote";

async function addData(db: D1Database, objects: any[], version: string) {
	for (let index = 0; index < objects.length; index++) {
		const obj = objects[index];
		await db.exec(
			`INSERT INTO staff (id, account, data) VALUES ('${
				obj.id
			}', \'ali\', '${JSON.stringify(obj)}');`
		);
	}
	await db.exec(
		`INSERT INTO staff_changes (version, account, ids) VALUES (${version}, 'ali', '${objects
			.map((x) => x.id)
			.join(",")}');`
	);
}

describe("Remote persistence", async () => {
	let remotePersistence: RemotePersistence;
	const env: { DB: D1Database; CACHE: KVNamespace } = {} as any;
	const mf = new Miniflare({
		modules: true,
		scriptPath: `./worker.js`,
		kvNamespaces: ["CACHE"],
		d1Databases: ["DB"],
	});
	global.fetch = mf.dispatchFetch as any;
	remotePersistence = new CloudFlareApexoDB({
		endpoint: "https://api.cloudflare.com",
		token: "token",
		name: "staff",
	});

	const token = "token";

	let workerFile = readFileSync(
		"../apexo-database/dist/index.js",
		"utf-8"
	).replace(
		/const response(.|\n)*return \{ success: true, account \};/,
		`return {success: true, account: "ali"}`
	);
	writeFileSync("./worker.js", workerFile);

	beforeAll(async () => {
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

	beforeEach(async () => {
		const cacheKeys = (await env.CACHE.list()).keys.map((x) => x.name);
		for (let index = 0; index < cacheKeys.length; index++) {
			const element = cacheKeys[index];
			await env.CACHE.delete(element);
		}
		await env.DB.exec(`DELETE FROM staff_changes;`);
		await env.DB.exec(`DELETE FROM staff;`);
	});

	it("fetching empty", async () => {
		global.fetch = mf.dispatchFetch as any;
		const result = await remotePersistence.getSince();
		expect(result).toEqual({ version: 0, rows: [] });
	});

	it("fetching for first time", async () => {
		global.fetch = mf.dispatchFetch as any;
		await addData(
			env.DB,
			[
				{ id: "1", name: "mike" },
				{ id: "2", name: "john" },
				{ id: "3", name: "tim" },
			],
			"100"
		);
		const result = await remotePersistence.getSince();
		expect(result).toEqual({
			version: 100,
			rows: [
				{ id: "1", data: "{\"id\":\"1\",\"name\":\"mike\"}" },
				{ id: "2", data: "{\"id\":\"2\",\"name\":\"john\"}" },
				{ id: "3", data: "{\"id\":\"3\",\"name\":\"tim\"}" },
			],
		});
	});

	it("should get the latest version", async () => {
		global.fetch = mf.dispatchFetch as any;
		const result = await remotePersistence.getVersion();
		expect(result).toBe(0);

		const cacheKeys = (await env.CACHE.list()).keys.map((x) => x.name);
		for (let index = 0; index < cacheKeys.length; index++) {
			const element = cacheKeys[index];
			await env.CACHE.delete(element);
		}

		await addData(env.DB, [{ id: "1", name: "mike" }], "100");
		const result2 = await remotePersistence.getVersion();
		expect(result2).toBe(100);
	});

	it("should send updates", async () => {
		global.fetch = mf.dispatchFetch as any;
		await remotePersistence.put([["id", "serialized"]]);
		const result2 = await remotePersistence.getSince();
		expect(result2.rows[0].data).toBe('serialized');
	});
});
