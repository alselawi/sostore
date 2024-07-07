export type RecursivePartial<T> = {
    [P in keyof T]?: T[P] extends object ? RecursivePartial<T[P]> : T[P];
};
/**
 * Base model: of which all documents extend (Main documents & Sub-documents)
*/
declare class BaseModel {
    /**
     * Use this method to create a new document before insertion/update into the observable store
     * This is where the actual mapping of pure JS object values get mapped into the model
     * It models the document and all of its sub-documents even if they are in an array
    */
    static new<T extends BaseModel>(this: new () => T, data?: RecursivePartial<T>): T;
    /**
     * Strips default values from the model,
     * so it can be written to the persistence layer with the least amount of space
     * and it can be sent over the network with the least amount of size
    */
    _stripDefaults?<T extends BaseModel>(this: T): T;
}
/**
 * Main document in the database extends this class:
 * A. Gets an ID automatically and a flag to mark it as deleted (soft delete)
 * D. gets Model.new() and model._stripDefaults() methods
*/
export declare class Document extends BaseModel {
    id: string;
    $$deleted?: true;
}
/**
 * Sub-documents extends this class:
 * gets Model.new() and model._stripDefaults() methods
*/
export declare class SubDocument extends BaseModel {
}
/**
 * Use this function to map sub-document inside main documents
 * It does nothing other than marking the value as sub-document
 * and setting a default value for it
*/
declare function mapSubModel<T extends typeof SubDocument>(ctr: T, def: InstanceType<T>): InstanceType<T>;
declare function mapSubModel<T extends typeof SubDocument>(ctr: T, def: Array<InstanceType<T>>): Array<InstanceType<T>>;
export { mapSubModel };
