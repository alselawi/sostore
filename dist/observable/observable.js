import * as utils from "./utils";
import { oMetaKey } from "./const";
import { ObservableArrayMeta, ObservableObjectMeta } from "./meta";
import { observingComponents } from "../react";
export class Observable {
    constructor(argument) {
        /**
         * An array of the all the observers registered to this observable
         */
        this.observers = [];
        this.target = Observable.isObservable(argument)
            ? argument
            : Array.isArray(argument)
                ? new ObservableArrayMeta({
                    target: argument,
                    ownKey: "",
                    parent: null,
                }).proxy
                : new ObservableObjectMeta({
                    target: argument,
                    ownKey: "",
                    parent: null,
                }).proxy;
        this.observers = this.target[oMetaKey].observers;
        this.observe(() => {
            Object.keys(observingComponents).forEach((key) => observingComponents[key]());
        });
        /**
         * # if the observable is an object, we need to copy its methods and getters as well
         * as I commonly use those for state management
        */
        if (utils.isTrueObj(argument) && !Observable.isObservable(argument)) {
            utils.copyPropertiesTo(argument, this.target);
        }
    }
    /**
     *
     * Remove an observer from the list of observers
     * can be given a single observer
     * an array of observers
     * or no argument to remove all observers
     */
    unobserve(observers) {
        if (!observers)
            return this.__unobserve();
        else if (Array.isArray(observers))
            return this.__unobserve(observers);
        else
            return this.__unobserve([observers]);
    }
    /**
     * Register a new observer
     */
    observe(observer) {
        this.__observe(observer);
    }
    /**
     * Execute a callback silently (without calling the observers)
     */
    silently(work) {
        this.target[oMetaKey].runningSilentWork = true;
        try {
            work(this.target);
        }
        finally {
            this.target[oMetaKey].runningSilentWork = false;
        }
    }
    /**
     * Get a non-observed copy of the observable array
     * changes to this copy wouldn't be replicated to the observable array
     * and wouldn't cause observers to be called
     */
    get copy() {
        return utils.copy(this.target);
    }
    __observe(observer) {
        const observers = this.target[oMetaKey].observers;
        if (!observers.some((o) => o === observer)) {
            observers.push(observer);
        }
    }
    __unobserve(observers) {
        const existingObs = this.target[oMetaKey].observers;
        let length = existingObs.length;
        if (!length) {
            return [];
        }
        if (!observers) {
            return existingObs.splice(0);
        }
        let spliced = [];
        for (let index = 0; index < observers.length; index++) {
            const observer = observers[index];
            const i = existingObs.indexOf(observer);
            if (i > -1) {
                spliced.push(existingObs.splice(i, 1)[0]);
            }
        }
        return spliced;
    }
    /**
     * when given any input it would return:
     * true: if it's an observable object (even if deeply nested inside observable array)
     * false: if not
     */
    static isObservable(input) {
        return !!(input && input[oMetaKey]);
    }
}
