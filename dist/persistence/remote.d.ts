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
}
export declare class CloudFlareApexoDB implements Persistence {
    private baseUrl;
    private token;
    private table;
    constructor({ endpoint, token, name, }: {
        endpoint: string;
        token: string;
        name: string;
    });
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
