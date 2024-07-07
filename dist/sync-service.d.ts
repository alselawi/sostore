export declare class SyncService {
    private baseUrl;
    private token;
    private table;
    constructor(baseUrl: string, token: string, table: string);
    fetchData(version?: number): Promise<{
        version: number;
        rows: {
            id: string;
            data: string;
        }[];
    }>;
    latestVersion(): Promise<number>;
    sendUpdates(data: {
        [key: string]: string;
    }): Promise<number>;
}
