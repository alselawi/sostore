import { Line, Model } from "./store";

export class SyncService<Row extends Model> {
	private baseUrl: string;
	private token: string;
	private table: string;

	constructor(baseUrl: string, token: string, table: string) {
		this.baseUrl = baseUrl;
		this.token = token;
		this.table = table;
	}

	async fetchData(version: number = 0) {
		let page = 0;
		let nextPage = true;
		let fetchedVersion = 0;
		let result = [] as Line[];
		while (nextPage) {
			const url = `${this.baseUrl}/${this.table}/${version}/${page}`;
			const response = await fetch(url, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${this.token}`,
				},
			});
			const res = await response.json();
			const output = JSON.parse(res.output) as {
				version: number;
				rows: Line[];
			};
			nextPage = output.rows.length > 0;
			fetchedVersion = output.version;
			result = result.concat(output.rows);
		}
		return { version: fetchedVersion, rows: result };
	}

	async latestVersion(): Promise<number> {
		const url = `${this.baseUrl}/${this.table}`;
		const response = await fetch(url, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${this.token}`,
			},
			body: JSON.stringify({}),
		});
		return (await response.json()).output.version;
	}

	async sendUpdates(data: { [key: string]: string }): Promise<number> {
		const url = `${this.baseUrl}/${this.table}`;
		const response = await fetch(url, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${this.token}`,
			},
			body: JSON.stringify(data),
		});
		return Number((await response.json()).output);
	}

	async deleteData(ids: string[]): Promise<any> {
		const url = `${this.baseUrl}/${this.table}/${ids.join("/")}`;
		const response = await fetch(url, {
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${this.token}`,
			},
		});
		return await response.json();
	}
}
