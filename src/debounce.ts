type DebouncedFunction<T extends (...args: any[]) => Promise<any>> = (
	...args: Parameters<T>
) => Promise<ReturnType<T>>;

export function debounce<T extends (...args: any[]) => Promise<any>>(
	func: T,
	wait: number
): DebouncedFunction<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let lastPromise: Promise<any> | null = null;

	return (...args: Parameters<T>): Promise<ReturnType<T>> => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
		}

		timeoutId = setTimeout(() => {
			timeoutId = null;
		}, wait);

		if (lastPromise === null) {
			lastPromise = new Promise((resolve, reject) => {
				timeoutId = setTimeout(async () => {
					try {
						const result = await func(...args);
						resolve(result);
					} catch (error) {
						reject(error);
					} finally {
						lastPromise = null;
					}
				}, wait);
			});
		}

		return lastPromise;
	};
}