type DebouncedFunction<T extends (...args: any[]) => Promise<any>> = (...args: Parameters<T>) => Promise<ReturnType<T>>;
export declare function debounce<T extends (...args: any[]) => Promise<any>>(func: T, wait: number): DebouncedFunction<T>;
export {};
