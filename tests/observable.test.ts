import { describe, test, it, expect } from "vitest";
import {
	observable,
	isObservable,
	Change,
	ObservableArray,
} from "../src/observable";

describe("observable", () => {
	test("should create an observable array", () => {
		const arr = [1, 2, 3];
		const { observable: obsArr } = observable(arr);
		expect(isObservable(obsArr)).toBe(true);
	});

	test("should observe changes in the array", async () => {
		const arr = [1, 2, 3];
		const { observable: obsArr, observe } = observable(arr);
		let changes: Change<number[]>[] = [];

		observe((c) => {
			changes = c;
		});

		obsArr.push(4);
		await new Promise((r) => setTimeout(r, 0));

		expect(changes.length).toBe(1);
		expect(changes[0].type).toBe("insert");
		expect(changes[0].path).toEqual([3]);
		expect(changes[0].value).toBe(4);
	});

	test("should unobserve changes in the array", async () => {
		const arr = [1, 2, 3];
		const { observable: obsArr, observe, unobserve } = observable(arr);
		let changes: Change<number[]>[] = [];

		const observer = (c: Change<number[]>[]) => {
			changes = c;
		};

		observe(observer);

		obsArr.push(4);

		await new Promise((r) => setTimeout(r, 0));

		expect(changes.length).toBe(1);

		await unobserve(observer);

		obsArr.push(5);

		expect(changes.length).toBe(1);
	});

	test("should silently modify the array without notifying observers", () => {
		const arr = [1, 2, 3];
		const { observable: obsArr, observe, silently } = observable(arr);
		let changes: Change<number[]>[] = [];

		observe((c) => {
			changes = c;
		});

		silently((o) => {
			o.push(4);
			o.pop();
		});

		expect(changes.length).toBe(0);
	});

	test("should observe multiple changes in the array", async () => {
		const arr = [1, 2, 3];
		const { observable: obsArr, observe } = observable(arr);
		let changes: Change<number[]>[] = [];

		observe((c) => {
			changes = c;
		});

		obsArr.push(4);
		obsArr.pop();
		obsArr.unshift(0);
		await new Promise((r) => setTimeout(r, 0));

		expect(changes.length).toBe(3);
		expect(changes[0].type).toBe("insert");
		expect(changes[0].path).toEqual([3]);
		expect(changes[0].value).toBe(4);
		expect(changes[1].type).toBe("delete");
		expect(changes[1].path).toEqual([3]);
		expect(changes[1].oldValue).toBe(4);
		expect(changes[2].type).toBe("insert");
		expect(changes[2].path).toEqual([0]);
		expect(changes[2].value).toBe(0);
	});

	test("should handle array modifications inside a nested array", async () => {
		const arr = [[1, 2], [3, 4]];
		const { observable: obsArr, observe } = observable(arr);
		let changes: Change<number[][]>[] = [];

		observe((c) => {
			changes = c;
		});

		obsArr[0].push(5);
		await new Promise((r) => setTimeout(r, 0));

		expect(changes.length).toBe(1);
		expect(changes[0].type).toBe("insert");
		expect(changes[0].path).toEqual([0, 2]);
		expect(changes[0].value).toBe(5);
	});
});
