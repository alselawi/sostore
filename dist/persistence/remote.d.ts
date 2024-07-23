import { Persistence } from "./type";
export interface RemotePersistence extends Persistence {
    getSince(version?: number): Promise<{
        version: number;
        rows: {
            id: string;
            data: string;
            ts?: string;
        }[];
    }>;
    isOnline: boolean;
    checkOnline: () => Promise<void>;
}
export declare class CloudFlareApexoDB implements RemotePersistence {
    private baseUrl;
    private token;
    private table;
    isOnline: boolean;
    constructor({ endpoint, token, name, }: {
        endpoint: string;
        token: string;
        name: string;
    });
    checkOnline(): Promise<void>;
    retryConnection(): void;
    getSince(version?: number): Promise<{
        version: number;
        rows: {
            id: string;
            data: string;
        }[];
    }>;
    getVersion(): Promise<number>;
    put(data: [string, string][]): Promise<void>;
}
