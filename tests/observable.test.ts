import { describe, test, it, expect, vi } from "vitest";
import { Change, Observable } from "../src/observable";

describe("observable", () => {
	describe("initialization", () => {
		it("should initialize correctly with a regular array", () => {
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);
			expect(Observable.isObservable(observableArray.target)).toBe(
				true
			);
			expect(JSON.stringify(observableArray.target)).toEqual(
				JSON.stringify(arr)
			);
		});

		it("should initialize correctly with an observable array", () => {
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);
			expect(Observable.isObservable(observableArray.target)).toBe(
				true
			);
			expect(JSON.stringify(observableArray.target)).toEqual(
				JSON.stringify(arr)
			);
		});

		it("should maintain array methods and properties when adding elements", () => {
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);
			observableArray.target.push(4);
			expect(observableArray.target.length).toBe(4);
			expect(observableArray.target.includes(2)).toBe(true);
		});
	});

	describe("isObservable", () => {
		it("should identify non-observable array", () => {
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);
			expect(Observable.isObservable(arr)).toBe(false);
		});
	});

	describe("observe", () => {
		it("should add an observer successfully when calling observe method", () => {
			const observer = (changes) => console.info(changes);
			const observableArray = new Observable([]);
			observableArray.observe(observer);
			expect(observableArray.observers).toContain(observer);
		});
		test("should observe changes in the array", async () => {
			const arr = [1, 2, 3];
			const o = new Observable(arr);
			let changes: Change<number[]>[] = [];

			o.observe((c) => {
				changes = c;
			});

			o.target.push(4);
			await new Promise((r) => setTimeout(r, 100));

			expect(changes.length).toBe(1);
			expect(changes[0].type).toBe("insert");
			expect(changes[0].path).toEqual([3]);
			expect(changes[0].value).toBe(4);
		});

		test("should observe multiple changes in the array", async () => {
			const arr = [1, 2, 3];
			const o = new Observable(arr);
			let changes: Change<number[]>[] = [];

			o.observe((c) => {
				changes = c;
			});

			o.target.push(4);
			o.target.pop();
			o.target.unshift(0);
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
			const arr = [
				[1, 2],
				[3, 4],
			];
			const o = new Observable(arr);
			let changes: Change<number[][]>[] = [];

			o.observe((c) => {
				changes = c;
			});

			o.target[0].push(5);
			await new Promise((r) => setTimeout(r, 0));

			expect(changes.length).toBe(1);
			expect(changes[0].type).toBe("insert");
			expect(changes[0].path).toEqual([0, 2]);
			expect(changes[0].value).toBe(5);
		});
	});

	describe("unobserve", () => {
		test("should unobserve changes in the array", async () => {
			const arr = [1, 2, 3];
			const o = new Observable(arr);
			let changes: Change<number[]>[] = [];

			const observer = (c: Change<number[]>[]) => {
				changes = c;
			};

			o.observe(observer);

			o.target.push(4);

			await new Promise((r) => setTimeout(r, 0));

			expect(changes.length).toBe(1);

			o.unobserve(observer);

			o.target.push(5);

			expect(changes.length).toBe(1);
		});

		it("should handle removing non-existent observers gracefully", () => {
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);
			const observer = (changes) => {};
			observableArray.observe(() => {});
			observableArray.unobserve(observer); // Trying to unobserve a non-existent observer
			expect(observableArray.observers.length).toBe(1);
		});

		it("should remove a specific observer when unobserve is called with that observer", () => {
			const observer1 = (changes) => console.info("Observer 1:", changes);
			const observer2 = (changes) => console.info("Observer 2:", changes);
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);

			observableArray.observe(observer1);
			observableArray.observe(observer2);
			expect(observableArray.observers.length).toBe(2);

			observableArray.unobserve(observer1);
			expect(observableArray.observers.length).toBe(1);
			expect(observableArray.observers[0]).toBe(observer2);
		});

		it("should remove all observers when no argument is provided", () => {
			const observer1 = (changes) => console.info("Observer 1 called");
			const observer2 = (changes) => console.info("Observer 2 called");
			const observableArray = new Observable([1, 2, 3]);
			observableArray.observe(observer1);
			observableArray.observe(observer2);

			observableArray.unobserve();

			expect(observableArray.observers).toEqual([]);
		});

		it("should not alter observers list if observer is not found", () => {
			const observer = (changes: Change<number[]>[]) => {};
			const observableArray = new Observable<number>([]);
			observableArray.observe(observer);
			const result = observableArray.unobserve(
				(changes: Change<number[]>[]) => {}
			);
			expect(result).toEqual([]);
		});
		it("should return removed observers", () => {
			const observer = (changes: Change<number[]>[]) => {};
			const observableArray = new Observable([1, 2, 3]);
			observableArray.observe(observer);
			const result = observableArray.unobserve();
			expect(result).toEqual([observer]);
		});
		it("should return an empty array when no observers are removed", () => {
			const observer = (changes: Change<number[]>[]) => {};
			const observableArray = new Observable([1, 2, 3]);
			observableArray.observe(observer);
			const result = observableArray.unobserve([]);
			expect(result).toEqual([]);
		});
	});

	describe("silently", () => {
		test("should silently modify the array without notifying observers", () => {
			const arr = [1, 2, 3];
			const o = new Observable(arr);
			let changes: Change<number[]>[] = [];

			o.observe((c) => {
				changes = c;
			});

			o.silently((o) => {
				o.push(4);
				o.pop();
			});

			expect(changes.length).toBe(0);
		});

		it("should temporarily disable observers and re-enable them after execution", async () => {
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);
			let observerCalled = false;
			const observer = (changes: Change<number[]>[]) => {
				observerCalled = true;
			};
			observableArray.observe(observer);
			observableArray.silently((o) => {
				o[0] = 10;
			});
			await new Promise((r) => setTimeout(r, 10));
			expect(observerCalled).toBe(false);

			observableArray.target.push(100);
			await new Promise((r) => setTimeout(r, 10));
			expect(observerCalled).toBe(true);
		});

		it("should temporarily disable observers and re-enable them after execution (deep)", async () => {
			const arr = [{ numbers: [1] }, { numbers: [2] }, { numbers: [3] }];
			const observableArray = new Observable(arr);
			let observerCalled = false;
			observableArray.observe((changes) => {
				observerCalled = true;
			});
			observableArray.silently((o) => {
				o[0].numbers[0] = 10;
			});
			await new Promise((r) => setTimeout(r, 10));
			expect(observerCalled).toBe(false);

			observableArray.target[2].numbers[0] = 30;
			await new Promise((r) => setTimeout(r, 10));
			expect(observerCalled).toBe(true);
		});

		it("should persist changes made during the work function", async () => {
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);
			const observer = vi.fn();
			observableArray.observe(observer);

			observableArray.silently((o) => {
				o[0] = 10;
				o.push(4);
			});
			await new Promise((r) => setTimeout(r, 10));
			expect(observer).toHaveBeenCalledTimes(0);
			expect(observableArray.copy).toEqual([10, 2, 3, 4]);
		});

		it("should re-enable observers even if work function throws an exception", async () => {
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);
			let observerCalled = false;
			const observer = (changes: Change<number[]>[]) => {
				observerCalled = true;
			};
			observableArray.observe(observer);

			expect(Observable.isObservable(observableArray.target)).toBe(
				true
			);
			expect(observableArray.copy).toEqual(arr);

			try {
				observableArray.silently((o) => {
					throw new Error("Exception in work function");
				});
			} catch (e) {}

			await new Promise((r) => setTimeout(r, 10));
			expect(observerCalled).toBe(false);

			observableArray.target[0] = 12;
			await new Promise((r) => setTimeout(r, 10));
			expect(observerCalled).toBe(true);
		});

		// Changes made before the exception should persist
		it("should persist changes made before an exception is thrown during the work function execution", () => {
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);

			try {
				observableArray.silently((o) => {
					o[0] = 10;
					throw new Error("Exception during work function");
				});
			} catch (e) {
				// Exception thrown intentionally
			}

			expect(observableArray.target[0]).toBe(10);
		});

		it("should propagate exception when work function throws an error", () => {
			const arr = [1, 2, 3];
			const observableArray = new Observable(arr);
			const error = new Error("Test Error");
			expect(() => {
				observableArray.silently(() => {
					throw error;
				});
			}).toThrow(error);
		});
	});
});
