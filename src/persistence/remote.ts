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

export class CloudFlareApexoDB implements RemotePersistence {
	private baseUrl: string;
	private token: string;
	private table: string;
	isOnline: boolean = true;

	constructor({
		endpoint,
		token,
		name,
	}: {
		endpoint: string;
		token: string;
		name: string;
	}) {
		this.baseUrl = endpoint;
		this.token = token;
		this.table = name;
		this.checkOnline();
	}

	async checkOnline() {
		try {
			await fetch(this.baseUrl, {
				method: "HEAD",
			});
			this.isOnline = true;
		} catch (e) {
			this.isOnline = false;
			this.retryConnection();
		}
	}

	retryConnection() {
		let i = setInterval(() => {
			if (this.isOnline) clearInterval(i);
			else this.checkOnline();
		}, 5000);
	}

	async getSince(version: number = 0) {
		let page = 0;
		let nextPage = true;
		let fetchedVersion = 0;
		let result = [] as { id: string; data: string }[];
		while (nextPage) {
			const url = `${this.baseUrl}/${this.table}/${version}/${page}`;
			let res: { success: boolean; output: string };
			try {
				const response = await fetch(url, {
					method: "GET",
					headers: {
						Authorization: `Bearer ${this.token}`,
					},
				});
				res = await response.json();
			} catch (e: any) {
				this.checkOnline();
				res = {
					success: false,
					output: ``,
				};
				break;
			}

			if (res.success === false) {
				result = [];
				version = 0;
				break;
			}

			const output = JSON.parse(res.output) as {
				version: number;
				rows: { id: string; data: string; ts?: string }[];
			};
			nextPage = output.rows.length > 0 && version !== 0;
			fetchedVersion = output.version;
			result = result.concat(output.rows);
			page = page + 1;
		}
		return { version: fetchedVersion, rows: result };
	}

	async getVersion(): Promise<number> {
		const url = `${this.baseUrl}/${this.table}/0/Infinity`;
		let res: { success: boolean; output: string };

		try {
			const response = await fetch(url, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${this.token}`,
				},
			});
			res = await response.json();
		} catch (e) {
			this.checkOnline();
			res = {
				success: false,
				output: ``,
			};
		}

		if (res.success) return Number(JSON.parse(res.output).version);
		else return 0;
	}

	async put(data: [string, string][]): Promise<void> {
		const reqBody = data.reduce((record, item) => {
			record[item[0]] = item[1];
			return record;
		}, {} as Record<string, string>);
		const url = `${this.baseUrl}/${this.table}`;
		try {
			await fetch(url, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${this.token}`,
				},
				body: JSON.stringify(reqBody),
			});
		} catch (e) {
			this.checkOnline();
			throw e;
		}
		return;
	}
}
