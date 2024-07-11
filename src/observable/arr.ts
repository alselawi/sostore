import { Change } from "./change";
import { oMetaKey, DELETE, INSERT, REVERSE, SHUFFLE, UPDATE } from "./const";
import { prepare } from "./prepare";
import { observed } from "./types";
import * as utils from "./utils";


/***
 * Proxied Array methods
 */
function proxiedPop<T extends any[]>(this: observed<T>) {
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
		new Change(
			DELETE,
			[poppedIndex],
			undefined,
			popResult,
			this,
			utils.copy(this)
		),
	];
	oMeta.callObservers(changes);

	return popResult;
}
function proxiedPush<T extends any[]>(this: observed<T>) {
	const oMeta = this[oMetaKey],
		target = oMeta.target,
		l = arguments.length,
		pushContent = new Array(l),
		initialLength = target.length;

	for (let i = 0; i < l; i++) {
		pushContent[i] = prepare.getObservedOf(
			arguments[i],
			initialLength + i,
			oMeta
		);
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
			utils.copy(this)
		);
	}
	oMeta.callObservers(changes);

	return pushResult;
}
function proxiedShift<T extends any[]>(this: observed<T>) {
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
		new Change(DELETE, [0], undefined, shiftResult, this, utils.copy(this)),
	];
	oMeta.callObservers(changes);

	return shiftResult;
}
function proxiedUnshift<T extends any[]>(this: observed<T>) {
	const oMeta = this[oMetaKey],
		target = oMeta.target,
		al = arguments.length,
		unshiftContent = new Array(al);

	for (let i = 0; i < al; i++) {
		unshiftContent[i] = prepare.getObservedOf(arguments[i], i, oMeta);
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
			utils.copy(this)
		);
	}
	oMeta.callObservers(changes);

	return unshiftResult;
}
function proxiedReverse<T extends any[]>(this: observed<T>): observed<T> {
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
		new Change(REVERSE, [], undefined, undefined, this, utils.copy(this)),
	];
	oMeta.callObservers(changes);

	return this;
}
function proxiedSort<T extends any[]>(
	this: observed<T>,
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
		new Change(SHUFFLE, [], undefined, undefined, this, utils.copy(this)),
	];
	oMeta.callObservers(changes);

	return this;
}
function proxiedFill<T extends any[]>(
	this: observed<T>,
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
			target[i] = prepare.getObservedOf(item, i, oMeta);
			if (i in prev) {
				tmpTarget = prev[i];
				if (tmpTarget && typeof tmpTarget === "object") {
					tmpObserved = tmpTarget[oMetaKey];
					if (tmpObserved) {
						tmpTarget = tmpObserved.detach();
					}
				}

				changes.push(
					new Change(UPDATE, [i], target[i], tmpTarget, this, utils.copy(this))
				);
			} else {
				changes.push(
					new Change(INSERT, [i], target[i], undefined, this, utils.copy(this))
				);
			}
		}

		oMeta.callObservers(changes);
	}

	return this;
}
function proxiedCopyWithin<T extends any[]>(
	this: observed<T>,
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
				nItem = prepare.getObservedOf(nItem, i, oMeta);
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
			changes.push(
				new Change(UPDATE, [i], nItem, oItem, this, utils.copy(this))
			);
		}

		oMeta.callObservers(changes);
	}

	return this;
}
function proxiedSplice<T extends any[]>(this: observed<T>) {
	const oMeta = this[oMetaKey],
		target = oMeta.target,
		splLen = arguments.length,
		spliceContent = new Array(splLen),
		tarLen = target.length;

	//	make newcomers observable
	for (let i = 0; i < splLen; i++) {
		spliceContent[i] = prepare.getObservedOf(arguments[i], i, oMeta);
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
					utils.copy(this)
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
					utils.copy(this)
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
				utils.copy(this)
			)
		);
	}
	oMeta.callObservers(changes);

	return spliceResult;
}
export const proxiedArrayMethods = {
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