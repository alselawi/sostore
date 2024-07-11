import * as utils from "./utils";
/**
 * Change class:
 * any change that would be sent to the observer will contain this class properties
 */
export class Change {
    constructor(type, path, value, oldValue, object, snapshot) {
        this.type = type;
        this.path = path;
        this.value = utils.copy(value);
        this.oldValue = utils.copy(oldValue);
        this.object = object;
        this.snapshot = snapshot;
    }
}
