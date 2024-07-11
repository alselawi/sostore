var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class CloudFlareApexoDB {
    constructor({ endpoint, token, name, }) {
        this.baseUrl = endpoint;
        this.token = token;
        this.table = name;
    }
    getSince() {
        return __awaiter(this, arguments, void 0, function* (version = 0) {
            let page = 0;
            let nextPage = true;
            let fetchedVersion = 0;
            let result = [];
            while (nextPage) {
                const url = `${this.baseUrl}/${this.table}/${version}/${page}`;
                const response = yield fetch(url, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                    },
                });
                const res = yield response.json();
                const output = JSON.parse(res.output);
                nextPage = output.rows.length > 0 && version !== 0;
                fetchedVersion = output.version;
                result = result.concat(output.rows);
                page = page + 1;
            }
            return { version: fetchedVersion, rows: result };
        });
    }
    getVersion() {
        return __awaiter(this, void 0, void 0, function* () {
            const url = `${this.baseUrl}/${this.table}/0/Infinity`;
            const response = yield fetch(url, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
            });
            const res = yield response.json();
            if (res.success)
                return Number(JSON.parse(res.output).version);
            else
                return 0;
        });
    }
    put(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const reqBody = data.reduce((record, item) => {
                record[item[0]] = item[1];
                return record;
            }, {});
            const url = `${this.baseUrl}/${this.table}`;
            const response = yield fetch(url, {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify(reqBody),
            });
            return;
        });
    }
}
