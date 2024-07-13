import * as utils from "./utils";
import { oMetaKey } from "./const";
import { observed, Observer } from "./types";
import { ObservableArrayMeta, ObservableObjectMeta } from "./meta";
import { observingComponents } from "../react";

export class Observable<D extends object> {
	/**
	 * Observable array, this is the actual observable array
	 * any changes made to this property would call the observers
	 */
	target: observed<D>;

	/**
	 * An array of the all the observers registered to this observable
	 */
	observers: Observer<D>[] = [];
	constructor(argument: D | observed<D>) {
		this.target = Observable.isObservable(argument)
			? (argument as observed<D>)
			: Array.isArray(argument)
			? new ObservableArrayMeta<D, D[]>({
					target: argument,
					ownKey: "",
					parent: null,
			  }).proxy
			: new ObservableObjectMeta<D>({
					target: argument,
					ownKey: "",
					parent: null,
			  }).proxy;
		this.observers = this.target[oMetaKey].observers;
		this.observe(() => {
			Object.keys(observingComponents).forEach((key) =>
				observingComponents[key]()
			);
		});
	}

	/**
	 *
	 * Remove an observer from the list of observers
	 * can be given a single observer
	 * an array of observers
	 * or no argument to remove all observers
	 */
	unobserve(observers?: Observer<D> | Observer<D>[]) {
		if (!observers) return this.__unobserve();
		else if (Array.isArray(observers)) return this.__unobserve(observers);
		else return this.__unobserve([observers]);
	}

	/**
	 * Register a new observer
	 */
	observe(observer: Observer<D>) {
		this.__observe(observer);
	}

	/**
	 * Execute a callback silently (without calling the observers)
	 */
	silently(work: (o: observed<D>) => any) {
		this.target[oMetaKey].runningSilentWork = true;
		try {
			work(this.target);
		} finally {
			this.target[oMetaKey].runningSilentWork = false;
		}
	}

	/**
	 * Get a non-observed copy of the observable array
	 * changes to this copy wouldn't be replicated to the observable array
	 * and wouldn't cause observers to be called
	 */
	get copy(): D {
		return utils.copy(this.target);
	}

	private __observe(observer: Observer<D>) {
		const observers = this.target[oMetaKey].observers;
		if (!observers.some((o) => o === observer)) {
			observers.push(observer);
		}
	}

	private __unobserve(observers?: Observer<D>[]) {
		const existingObs = this.target[oMetaKey].observers;
		let length = existingObs.length;
		if (!length) {
			return [];
		}

		if (!observers) {
			return existingObs.splice(0);
		}

		let spliced: Observer<D>[] = [];
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
	static isObservable(input: any) {
		return !!(input && input[oMetaKey]);
	}
}