export declare const observingComponents: Record<string, () => void>;
/**
 * Enhances a React component to automatically re-render when the observed store changes.
 * @param store - An instance of Store that extends Document.
 * @returns A higher-order function that takes a React component as an argument.
 */
export declare function observe<K extends object>(component: K): K;
