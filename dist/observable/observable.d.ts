import { observed, Observer } from "./types";
export declare class Observable<D extends object> {
    /**
     * Observable array, this is the actual observable array
     * any changes made to this property would call the observers
     */
    target: observed<D>;
    /**
     * An array of the all the observers registered to this observable
     */
    observers: Observer<D>[];
    constructor(argument: D | observed<D>);
    /**
     *
     * Remove an observer from the list of observers
     * can be given a single observer
     * an array of observers
     * or no argument to remove all observers
     */
    unobserve(observers?: Observer<D> | Observer<D>[]): Observer<D>[];
    /**
     * Register a new observer
     */
    observe(observer: Observer<D>): void;
    /**
     * Execute a callback silently (without calling the observers)
     */
    silently(work: (o: observed<D>) => any): void;
    /**
     * Get a non-observed copy of the observable array
     * changes to this copy wouldn't be replicated to the observable array
     * and wouldn't cause observers to be called
     */
    get copy(): D;
    private __observe;
    private __unobserve;
    /**
     * when given any input it would return:
     * true: if it's an observable object (even if deeply nested inside observable array)
     * false: if not
     */
    static isObservable(input: any): boolean;
}
