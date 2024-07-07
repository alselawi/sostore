import { uuid } from "./uuid";
/**
 * Base model: of which all documents extend (Main documents & Sub-documents)
*/
class BaseModel {
    /**
     * Use this method to create a new document before insertion/update into the observable store
     * This is where the actual mapping of pure JS object values get mapped into the model
     * It models the document and all of its sub-documents even if they are in an array
    */
    static new(data) {
        const instance = new this();
        if (typeof data !== "object" || data === null) {
            return instance;
        }
        const keys = Object.keys(Object.assign(Object.assign({}, instance), data));
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            let insVal = instance[key];
            let dataVal = data[key];
            if (insVal && insVal["_$SHOULD_MAP$_"]) {
                if (dataVal === undefined) {
                    instance[key] = insVal["def"];
                }
                else if (Array.isArray(dataVal)) {
                    instance[key] = dataVal.map((x) => insVal.ctr.new(x));
                }
                else {
                    instance[key] = insVal.ctr.new(dataVal);
                }
            }
            else {
                instance[key] = dataVal === undefined ? insVal : dataVal;
            }
        }
        return instance;
    }
    /**
     * Strips default values from the model,
     * so it can be written to the persistence layer with the least amount of space
     * and it can be sent over the network with the least amount of size
    */
    _stripDefaults() {
        // maintain a cache of defaults
        if (!this.constructor._$def) {
            this.constructor._$def = this.constructor.new({});
        }
        let def = this.constructor._$def;
        const newData = {};
        for (const [key, oldV] of Object.entries(this)) {
            const defV = def[key];
            // handling arrays of sub-documents
            if (Array.isArray(oldV) && oldV[0] && oldV[0]._stripDefaults) {
                newData[key] = oldV.map((sub) => sub._stripDefaults());
                if (newData[key].length === 0)
                    delete newData[key]; // disregard empty arrays
            }
            // handling direct child sub-document
            else if (typeof oldV === "object" &&
                oldV !== null &&
                oldV._stripDefaults) {
                newData[key] = oldV._stripDefaults();
                if (Object.keys(newData[key]).length === 0)
                    delete newData[key]; // disregard empty objects
            }
            // handling non-sub-document values
            // we're converting to a string to eliminate non-primitive
            else if (JSON.stringify(defV) !== JSON.stringify(oldV))
                newData[key] = oldV;
        }
        return newData;
    }
}
/**
 * Main document in the database extends this class:
 * A. Gets an ID automatically and a flag to mark it as deleted (soft delete)
 * D. gets Model.new() and model._stripDefaults() methods
*/
export class Document extends BaseModel {
    constructor() {
        super(...arguments);
        this.id = uuid();
    }
}
/**
 * Sub-documents extends this class:
 * gets Model.new() and model._stripDefaults() methods
*/
export class SubDocument extends BaseModel {
}
function mapSubModel(ctr, def) {
    return {
        _$SHOULD_MAP$_: true,
        def,
        ctr,
    };
}
export { mapSubModel };
