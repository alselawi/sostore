export interface Persistence {
	put(entries: [string, string][]): Promise<void>;
	getVersion(): Promise<number>;
}