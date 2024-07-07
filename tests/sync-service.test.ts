import { SyncService } from "../src/sync-service";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("SyncService", () => {
	let syncService: SyncService;
	beforeEach(() => {
		// Initialize SyncService with dummy values
		syncService = new SyncService(
			"http://example.com",
			"dummyToken",
			"dummyTable"
		);

		global.fetch = vi.fn().mockResolvedValue({
			json: vi.fn().mockResolvedValue({
				output: JSON.stringify({
					version: 1,
					rows: [{ id: 1, name: "Test" }],
				}),
			}),
		});
	});

	it("should fetch data", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			json: vi.fn().mockResolvedValue({
				output: JSON.stringify({ version: 1, rows: [{ id: 1, name: "Test" }] }),
			}),
		});

		// Call the fetchData method
		const result = await syncService.fetchData();

		// Assertions
		expect(global.fetch).toHaveBeenCalledWith(
			"http://example.com/dummyTable/0/0",
			{
				method: "GET",
				headers: {
					Authorization: "Bearer dummyToken",
				},
			}
		);
		expect(result).toEqual({ version: 1, rows: [{ id: 1, name: "Test" }] });
	});

	it("should get the latest version", async () => {
		// Mock the fetch function
		const mockFetch = vi.fn().mockResolvedValue({
			json: vi.fn().mockResolvedValue({
				success: true,
				output: JSON.stringify({
                    rows: [],
                    version: 2
                }),
			}),
		});
		global.fetch = mockFetch;

		// Call the latestVersion method
		const result = await syncService.latestVersion();

		// Assertions
		expect(mockFetch).toHaveBeenCalledWith("http://example.com/dummyTable/0/Infinity", {
			method: "GET",
			headers: {
				Authorization: "Bearer dummyToken",
			},
		});
		expect(result).toBe(2);
	});

	it("should send updates", async () => {
		// Mock the fetch function
		const mockFetch = vi.fn().mockResolvedValue({
			json: vi.fn().mockResolvedValue({
				output: "3",
			}),
		});
		global.fetch = mockFetch;

		// Call the sendUpdates method
		const result = await syncService.sendUpdates({ key: "value" });

		// Assertions
		expect(mockFetch).toHaveBeenCalledWith("http://example.com/dummyTable", {
			method: "PUT",
			headers: {
				Authorization: "Bearer dummyToken",
			},
			body: JSON.stringify({ key: "value" }),
		});
		expect(result).toBe(3);
	});
});
