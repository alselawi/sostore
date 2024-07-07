export class SyncService {
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
		let result = [] as { id: string; data: string }[];
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
				rows: { id: string; data: string }[];
			};
			nextPage = output.rows.length > 0 && version !== 0;
			fetchedVersion = output.version;
			result = result.concat(output.rows);
			page = page + 1;
		}
		return { version: fetchedVersion, rows: result };
	}

	async latestVersion(): Promise<number> {
		const url = `${this.baseUrl}/${this.table}/0/Infinity`;
		const response = await fetch(url, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${this.token}`,
			},
		});
		const res = await response.json();
		if (res.success) return Number(JSON.parse(res.output).version);
		else return 0;
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
}
