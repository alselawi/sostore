import { observed } from "./types";
import * as utils from "./utils"

/**
 * Change class:
 * any change that would be sent to the observer will contain this class properties
 */
export class Change<D extends object> {
	type: "insert" | "update" | "delete" | "reverse" | "shuffle";
	path: (string | number | symbol)[];
	value?: any;
	oldValue?: any;
	object: any;
	snapshot: observed<D>;
	constructor(
		type: typeof this.type,
		path: (string | number | symbol)[],
		value: any | undefined,
		oldValue: any | undefined,
		object: any,
		snapshot: observed<D>
	) {
		this.type = type;
		this.path = path;
		this.value = utils.copy(value);
		this.oldValue = utils.copy(oldValue);
		this.object = object;
		this.snapshot = snapshot;
	}
}