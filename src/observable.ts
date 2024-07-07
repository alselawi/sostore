/**
 * Creating an an observable array
 */

export interface ObservableArray<A extends object> {
	// actually observable array
	observable: Observable<A>;
	// call a callback function when the array changes (i.e. creates an observer)
	observe: (observer: Observer<A>) => void;
	// removes a specific (or all) observers (i.e. callbacks)
	unobserve: (
		observers?: Observer<A> | Observer<A>[]
	) => Promise<Observer<A>[]>;
	// do something to the array without notifying the observers
	silently: (work: (o: Observable<A>) => any) => void;
}

type Observable<T extends object> = T & { [oMetaKey]: OMetaBase<T> };
type ChangeType = "insert" | "update" | "delete" | "reverse" | "shuffle";
type PrepareFunction<T extends object> = (
	source: T,
	oMeta: OMetaBase<T>,
	visited: Set<any>
) => Observable<T>;

interface MetaProperties<T> {
	target: T;
	ownKey: symbol | number | string;
	parent: any | null;
	visited?: Set<any>;
}

interface Observer<T> {
	(changes: Change<T>[]): void;
}

const INSERT = "insert";
const UPDATE = "update";
const DELETE = "delete";
const REVERSE = "reverse";
const SHUFFLE = "shuffle";
const oMetaKey = Symbol.for("object-observer-meta-key-0");

function findGrandParent<T extends object>(observable: OMetaBase<T>): any {
	if (observable.parent) return findGrandParent(observable.parent);
	else return observable;
}

function copy(v: any) {
	return JSON.parse(JSON.stringify({ tmp: v })).tmp;
}

function prepareObject<T extends object>(
	source: T,
	oMeta: OMetaBase<T>,
	visited: Set<any>
): Observable<T> {
	const target: Observable<T> = {} as any;
	target[oMetaKey] = oMeta;
	for (const key in source) {
		target[key] = getObservedOf(source[key], key, oMeta, visited);
	}
	return target;
}
function prepareArray<T extends any[]>(
	source: T,
	oMeta: OMetaBase<T>,
	visited: Set<any>
): Observable<T> {
	let l = source.length;
	const target: Observable<T> = new Array(l) as any;
	target[oMetaKey] = oMeta;
	for (let i = 0; i < l; i++) {
		target[i] = getObservedOf(source[i], i, oMeta, visited);
	}
	return target;
}
function callObserverSafe<T>(
	listener: (c: Change<T>[]) => void,
	changes: Change<T>[]
) {
	try {
		listener(changes);
	} catch (e) {
		console.error(`Failed to notify listener ${listener} with ${changes}`, e);
	}
}
function callObserversFromMT<T extends object>(this: OMetaBase<T>) {
	const batches = this.batches;
	this.batches = [];
	for (const [listener, changes] of batches) {
		callObserverSafe(listener, changes);
	}
}
function callObservers<T extends object>(
	oMeta: OMetaBase<T>,
	changes: Change<T>[]
) {
	let currentObservable: OMetaBase<T> | null = oMeta;
	const l = changes.length;
	do {
		let observers = currentObservable.observers;
		let i = observers.length;
		while (i--) {
			let target = observers[i];
			if (changes.length) {
				if (currentObservable.batches.length === 0) {
					// @ts-ignore
					queueMicrotask(callObserversFromMT.bind(currentObservable));
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
					copy(findGrandParent(currentObservable).proxy)
				);
			}
			currentObservable = parent;
		} else {
			currentObservable = null;
		}
	} while (currentObservable);
}
function getObservedOf(
	item: any,
	key: string | number | symbol,
	parent: any,
	visited?: Set<any>
) {
	if (visited !== undefined && visited.has(item)) {
		return null;
	} else if (typeof item !== "object" || item === null) {
		return item;
	} else if (Array.isArray(item)) {
		return new ArrayOMeta({
			target: item,
			ownKey: key,
			parent: parent,
			visited,
		}).proxy;
	} else if (item instanceof Date) {
		return item;
	} else {
		return new ObjectOMeta({
			target: item,
			ownKey: key,
			parent: parent,
			visited,
		}).proxy;
	}
}
function proxiedPop<T extends any[]>(this: Observable<T>) {
	const oMeta = this[oMetaKey],
		target = oMeta.target,
		poppedIndex = target.length - 1;

	let popResult = target.pop();
	if (popResult && typeof popResult === "object") {
		const tmpObserved = popResult[oMetaKey];
		if (tmpObserved) {
			popResult = tmpObserved.detach();
		}
	}

	const changes = [
		new Change(DELETE, [poppedIndex], undefined, popResult, this, copy(this)),
	];
	callObservers(oMeta, changes);

	return popResult;
}
function proxiedPush<T extends any[]>(this: Observable<T>) {
	const oMeta = this[oMetaKey],
		target = oMeta.target,
		l = arguments.length,
		pushContent = new Array(l),
		initialLength = target.length;

	for (let i = 0; i < l; i++) {
		pushContent[i] = getObservedOf(arguments[i], initialLength + i, oMeta);
	}
	const pushResult = Reflect.apply(target.push, target, pushContent);

	const changes = [];
	for (let i = initialLength, j = target.length; i < j; i++) {
		changes[i - initialLength] = new Change(
			INSERT,
			[i],
			target[i],
			undefined,
			this,
			copy(this)
		);
	}
	callObservers(oMeta, changes);

	return pushResult;
}
function proxiedShift<T extends any[]>(this: Observable<T>) {
	const oMeta = this[oMetaKey],
		target = oMeta.target;
	let shiftResult, i, l, item, tmpObserved;

	shiftResult = target.shift();
	if (shiftResult && typeof shiftResult === "object") {
		tmpObserved = shiftResult[oMetaKey];
		if (tmpObserved) {
			shiftResult = tmpObserved.detach();
		}
	}

	//	update indices of the remaining items
	for (i = 0, l = target.length; i < l; i++) {
		item = target[i];
		if (item && typeof item === "object") {
			tmpObserved = item[oMetaKey];
			if (tmpObserved) {
				tmpObserved.ownKey = i;
			}
		}
	}

	const changes = [
		new Change(DELETE, [0], undefined, shiftResult, this, copy(this)),
	];
	callObservers(oMeta, changes);

	return shiftResult;
}
function proxiedUnshift<T extends any[]>(this: Observable<T>) {
	const oMeta = this[oMetaKey],
		target = oMeta.target,
		al = arguments.length,
		unshiftContent = new Array(al);

	for (let i = 0; i < al; i++) {
		unshiftContent[i] = getObservedOf(arguments[i], i, oMeta);
	}
	const unshiftResult = Reflect.apply(target.unshift, target, unshiftContent);

	for (let i = 0, l = target.length, item; i < l; i++) {
		item = target[i];
		if (item && typeof item === "object") {
			const tmpObserved = item[oMetaKey];
			if (tmpObserved) {
				tmpObserved.ownKey = i;
			}
		}
	}

	//	publish changes
	const l = unshiftContent.length;
	const changes = new Array(l);
	for (let i = 0; i < l; i++) {
		changes[i] = new Change(
			INSERT,
			[i],
			target[i],
			undefined,
			this,
			copy(this)
		);
	}
	callObservers(oMeta, changes);

	return unshiftResult;
}
function proxiedReverse<T extends any[]>(this: Observable<T>): Observable<T> {
	const oMeta = this[oMetaKey],
		target = oMeta.target;
	let i, l, item;

	target.reverse();
	for (i = 0, l = target.length; i < l; i++) {
		item = target[i];
		if (item && typeof item === "object") {
			const tmpObserved = item[oMetaKey];
			if (tmpObserved) {
				tmpObserved.ownKey = i;
			}
		}
	}

	const changes = [
		new Change(REVERSE, [], undefined, undefined, this, copy(this)),
	];
	callObservers(oMeta, changes);

	return this;
}
function proxiedSort<T extends any[]>(
	this: Observable<T>,
	comparator: (a: any, b: any) => number
) {
	const oMeta = this[oMetaKey],
		target = oMeta.target;
	let i, l, item;

	target.sort(comparator);
	for (i = 0, l = target.length; i < l; i++) {
		item = target[i];
		if (item && typeof item === "object") {
			const tmpObserved = item[oMetaKey];
			if (tmpObserved) {
				tmpObserved.ownKey = i;
			}
		}
	}

	const changes = [
		new Change(SHUFFLE, [], undefined, undefined, this, copy(this)),
	];
	callObservers(oMeta, changes);

	return this;
}
function proxiedFill<T extends any[]>(
	this: Observable<T>,
	filVal: any,
	start: number,
	end: number
) {
	const oMeta = this[oMetaKey],
		target = oMeta.target,
		changes = [],
		tarLen = target.length,
		prev = target.slice(0);
	start =
		start === undefined
			? 0
			: start < 0
			? Math.max(tarLen + start, 0)
			: Math.min(start, tarLen);
	end =
		end === undefined
			? tarLen
			: end < 0
			? Math.max(tarLen + end, 0)
			: Math.min(end, tarLen);

	if (start < tarLen && end > start) {
		target.fill(filVal, start, end);

		let tmpObserved;
		for (let i = start, item, tmpTarget; i < end; i++) {
			item = target[i];
			target[i] = getObservedOf(item, i, oMeta);
			if (i in prev) {
				tmpTarget = prev[i];
				if (tmpTarget && typeof tmpTarget === "object") {
					tmpObserved = tmpTarget[oMetaKey];
					if (tmpObserved) {
						tmpTarget = tmpObserved.detach();
					}
				}

				changes.push(
					new Change(UPDATE, [i], target[i], tmpTarget, this, copy(this))
				);
			} else {
				changes.push(
					new Change(INSERT, [i], target[i], undefined, this, copy(this))
				);
			}
		}

		callObservers(oMeta, changes);
	}

	return this;
}
function proxiedCopyWithin<T extends any[]>(
	this: Observable<T>,
	dest: number,
	start: number,
	end: number
) {
	const oMeta = this[oMetaKey],
		target = oMeta.target,
		tarLen = target.length;
	dest = dest < 0 ? Math.max(tarLen + dest, 0) : dest;
	start =
		start === undefined
			? 0
			: start < 0
			? Math.max(tarLen + start, 0)
			: Math.min(start, tarLen);
	end =
		end === undefined
			? tarLen
			: end < 0
			? Math.max(tarLen + end, 0)
			: Math.min(end, tarLen);
	const len = Math.min(end - start, tarLen - dest);

	if (dest < tarLen && dest !== start && len > 0) {
		const prev = target.slice(0),
			changes = [];

		target.copyWithin(dest, start, end);

		for (let i = dest, nItem, oItem, tmpObserved; i < dest + len; i++) {
			//	update newly placed observables, if any
			nItem = target[i];
			if (nItem && typeof nItem === "object") {
				nItem = getObservedOf(nItem, i, oMeta);
				target[i] = nItem;
			}

			//	detach overridden observables, if any
			oItem = prev[i];
			if (oItem && typeof oItem === "object") {
				tmpObserved = oItem[oMetaKey];
				if (tmpObserved) {
					oItem = tmpObserved.detach();
				}
			}

			if (typeof nItem !== "object" && nItem === oItem) {
				continue;
			}
			changes.push(new Change(UPDATE, [i], nItem, oItem, this, copy(this)));
		}

		callObservers(oMeta, changes);
	}

	return this;
}
function proxiedSplice<T extends any[]>(this: Observable<T>) {
	const oMeta = this[oMetaKey],
		target = oMeta.target,
		splLen = arguments.length,
		spliceContent = new Array(splLen),
		tarLen = target.length;

	//	make newcomers observable
	for (let i = 0; i < splLen; i++) {
		spliceContent[i] = getObservedOf(arguments[i], i, oMeta);
	}

	//	calculate pointers
	const startIndex =
			splLen === 0
				? 0
				: spliceContent[0] < 0
				? tarLen + spliceContent[0]
				: spliceContent[0],
		removed = splLen < 2 ? tarLen - startIndex : spliceContent[1],
		inserted = Math.max(splLen - 2, 0),
		spliceResult = Reflect.apply(target.splice, target, spliceContent),
		newTarLen = target.length;

	//	re-index the paths
	let tmpObserved;
	for (let i = 0, item; i < newTarLen; i++) {
		item = target[i];
		if (item && typeof item === "object") {
			tmpObserved = item[oMetaKey];
			if (tmpObserved) {
				tmpObserved.ownKey = i;
			}
		}
	}

	//	detach removed objects
	let i, l, item;
	for (i = 0, l = spliceResult.length; i < l; i++) {
		item = spliceResult[i];
		if (item && typeof item === "object") {
			tmpObserved = item[oMetaKey];
			if (tmpObserved) {
				spliceResult[i] = tmpObserved.detach();
			}
		}
	}

	const changes = [];
	let index;
	for (index = 0; index < removed; index++) {
		if (index < inserted) {
			changes.push(
				new Change(
					UPDATE,
					[startIndex + index],
					target[startIndex + index],
					spliceResult[index],
					this,
					copy(this)
				)
			);
		} else {
			changes.push(
				new Change(
					DELETE,
					[startIndex + index],
					undefined,
					spliceResult[index],
					this,
					copy(this)
				)
			);
		}
	}
	for (; index < inserted; index++) {
		changes.push(
			new Change(
				INSERT,
				[startIndex + index],
				target[startIndex + index],
				undefined,
				this,
				copy(this)
			)
		);
	}
	callObservers(oMeta, changes);

	return spliceResult;
}

const proxiedArrayMethods = {
	pop: proxiedPop,
	push: proxiedPush,
	shift: proxiedShift,
	unshift: proxiedUnshift,
	reverse: proxiedReverse,
	sort: proxiedSort,
	fill: proxiedFill,
	copyWithin: proxiedCopyWithin,
	splice: proxiedSplice,
};

class Change<T> {
	type: ChangeType;
	path: (string | number | symbol)[];
	value?: any;
	oldValue?: any;
	object: any;
	snapshot: T;
	constructor(
		type: ChangeType,
		path: (string | number | symbol)[],
		value: any | undefined,
		oldValue: any | undefined,
		object: T,
		snapshot: T
	) {
		this.type = type;
		this.path = path;
		this.value = copy(value);
		this.oldValue = copy(oldValue);
		this.object = object;
		this.snapshot = snapshot;
	}
}

class OMetaBase<T extends object> {
	parent: any;
	ownKey: string | number | symbol;
	observers: Observer<T>[] = [];
	revocable;
	proxy: Observable<T>;
	target: T;
	batches: [Observer<T>, Change<T>[]][] = [];

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
		this.revocable = Proxy.revocable<Observable<T>>(targetClone, this);
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
			const newValue = getObservedOf(value, key, this);
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
								copy(this.proxy)
							),
					  ]
					: [
							new Change(
								UPDATE,
								[key],
								newValue,
								oldValue,
								this.proxy,
								copy(this.proxy)
							),
					  ];
			callObservers(this, changes);
		}

		return true;
	}

	deleteProperty(target: Observable<T>, key: string | symbol) {
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
				copy(this.proxy)
			),
		];
		callObservers(this, changes);

		return true;
	}
}

class ObjectOMeta<T extends object> extends OMetaBase<T> {
	constructor(properties: MetaProperties<T>) {
		super(properties, prepareObject);
	}
}

class ArrayOMeta<G, T extends Array<G>> extends OMetaBase<T> {
	constructor(properties: MetaProperties<T>) {
		super(properties, prepareArray);
	}

	get(target: T, key: keyof typeof proxiedArrayMethods) {
		return proxiedArrayMethods[key] || target[key];
	}
}

function observable<D, A extends D[]>(
	target: A | Observable<A>
): ObservableArray<A> {
	const o = isObservable(target)
		? (target as Observable<A>)
		: new ArrayOMeta({
				target: target,
				ownKey: "",
				parent: null,
		  }).proxy;

	async function unobserve(observers?: Observer<A> | Observer<A>[]) {
		if (!observers) return await __unobserve(o);
		else if (Array.isArray(observers)) return await __unobserve(o, observers);
		else return await __unobserve(o, [observers]);
	}

	function observe(observer: Observer<A>) {
		__observe(o, observer);
	}

	async function silently(work: (o: Observable<A>) => any) {
		const observers = await __unobserve(o);
		try {
			work(o);
		} finally {
			for (const observer of observers) {
				__observe(o, observer);
			}
		}
	}

	return {
		observe,
		unobserve,
		silently,
		observable: o,
	};
}

function isObservable<T>(input: T) {
	return !!(input && (input as any)[oMetaKey]);
}

function __observe<T extends object>(
	observable: Observable<T>,
	observer: Observer<T>
) {
	const observers = observable[oMetaKey].observers;
	if (!observers.some((o) => o === observer)) {
		observers.push(observer);
	}
}

async function __unobserve<T extends object>(
	observable: Observable<T> | Promise<Observable<T>>,
	observers?: Observer<T>[]
) {
	if (observable instanceof Promise)
		observable = await Promise.resolve(observable);
	const existingObs = observable[oMetaKey].observers;
	let length = existingObs.length;
	if (!length) {
		return [];
	}

	if (!observers) {
		return existingObs.splice(0);
	}

	let spliced: Observer<T>[] = [];
	for (let index = 0; index < observers.length; index++) {
		const observer = observers[index];
		const i = existingObs.indexOf(observer);
		if (i > -1) {
			spliced.push(existingObs.splice(i, 1)[0]);
		}
	}
	return spliced;
}

export { observable, isObservable, Change };
