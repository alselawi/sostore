import { proxiedArrayMethods } from "./arr";
import { Change } from "./change";
import { oMetaKey, DELETE, INSERT,  UPDATE } from "./const";
import { prepare } from "./prepare";
import { observed, Observer, PrepareFunction } from "./types";
import * as utils from "./utils";

/**
 * Meta object to be added to observable on preparation
 */

interface MetaProperties<T> {
	target: T;
	ownKey: symbol | number | string;
	parent: any | null;
	visited?: Set<any>;
}

export class ObservableMeta<T extends object> {
	parent: any;
	ownKey: string | number | symbol;
	observers: Observer<T>[] = [];
	revocable;
	proxy: observed<T>;
	target: T;
	batches: [Observer<T>, Change<T>[]][] = [];
	runningSilentWork: boolean = false;
	constructor(
		properties: MetaProperties<T>,
		cloningFunction: PrepareFunction<T>
	) {
		const { target, parent, ownKey, visited = new Set() } = properties;
		if (parent && ownKey !== undefined) {
			this.parent = parent;
			this.ownKey = ownKey;
		} else {
			this.parent = null;
			this.ownKey = "";
		}
		visited.add(target);
		const targetClone = cloningFunction(target, this, visited);
		visited.delete(target);
		this.revocable = Proxy.revocable<observed<T>>(targetClone, this);
		this.proxy = this.revocable.proxy;
		this.target = targetClone;
		this.batches = [];
	}

	detach() {
		this.parent = null;
		return this.target;
	}

	set(target: T, key: number | string | symbol, value: any) {
		let oldValue = target[key as keyof T];

		if (value !== oldValue) {
			const newValue = prepare.getObservedOf(value, key, this);
			target[key as keyof T] = newValue;

			if (oldValue && typeof oldValue === "object") {
				const tmpObserved = (oldValue as any)[oMetaKey];
				if (tmpObserved) {
					oldValue = tmpObserved.detach();
				}
			}

			const changes =
				oldValue === undefined
					? [
							new Change(
								INSERT,
								[key],
								newValue,
								undefined,
								this.proxy,
								utils.copy(this.proxy)
							),
					  ]
					: [
							new Change(
								UPDATE,
								[key],
								newValue,
								oldValue,
								this.proxy,
								utils.copy(this.proxy)
							),
					  ];
			this.callObservers(changes);
		}

		return true;
	}

	deleteProperty(target: observed<T>, key: string | symbol) {
		let oldValue = target[key as keyof T];

		delete target[key as keyof T];

		if (oldValue && typeof oldValue === "object") {
			const tmpObserved = (oldValue as any)[oMetaKey];
			if (tmpObserved) {
				oldValue = tmpObserved.detach();
			}
		}

		const changes = [
			new Change(
				DELETE,
				[key],
				undefined,
				oldValue,
				this.proxy,
				utils.copy(this.proxy)
			),
		];
		this.callObservers(changes);

		return true;
	}

	QueMicroTask(observableMeta: ObservableMeta<T>) {
		let skip = false;
		if (utils.findGrandParent(this).runningSilentWork) skip = true;
		queueMicrotask(() => {
			const batches = observableMeta.batches;
			observableMeta.batches = [];
			for (const [listener, changes] of batches) {
				try {
					if (skip) break;
					listener(changes);
				} catch (e) {
					console.error(
						`Failed to notify listener ${listener} with ${changes}:`,
						e
					);
				}
			}
		});
	}

	callObservers(changes: Change<T>[]) {
		let currentObservable: ObservableMeta<T> | null = this;
		const l = changes.length;
		do {
			let observers = currentObservable.observers;
			let i = observers.length;
			while (i--) {
				let target = observers[i];
				if (changes.length) {
					if (currentObservable.batches.length === 0) {
						this.QueMicroTask(currentObservable);
					}
					let rb: [Observer<T>, Change<T>[]] | undefined;
					for (const batch of currentObservable.batches) {
						if (batch[0] === target) {
							rb = batch;
							break;
						}
					}
					if (!rb) {
						rb = [target, []];
						currentObservable.batches.push(rb);
					}
					Array.prototype.push.apply(rb[1], changes);
				}
			}

			//	cloning all the changes and notifying in context of parent
			const parent: any = currentObservable.parent;
			if (parent) {
				for (let j = 0; j < l; j++) {
					const change = changes[j];
					changes[j] = new Change(
						change.type,
						[currentObservable.ownKey, ...change.path],
						change.value,
						change.oldValue,
						change.object,
						utils.copy(utils.findGrandParent(currentObservable).proxy)
					);
				}
				currentObservable = parent;
			} else {
				currentObservable = null;
			}
		} while (currentObservable);
	}
}

export class ObservableObjectMeta<T extends object> extends ObservableMeta<T> {
	constructor(properties: MetaProperties<T>) {
		super(properties, prepare.object);
	}
}

export class ObservableArrayMeta<G, T extends Array<G>> extends ObservableMeta<any> {
	constructor(properties: MetaProperties<T>) {
		super(properties, prepare.array);
	}

	get(target: T, key: keyof typeof proxiedArrayMethods) {
		return proxiedArrayMethods[key] || target[key];
	}
}