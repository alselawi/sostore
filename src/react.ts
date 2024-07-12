import { Document } from "./model";
import { Observable } from "./observable";
import { Store } from "./store";

/**
 * Enhances a React component to automatically re-render when the observed store changes.
 * @param store - An instance of Store that extends Document.
 * @returns A higher-order function that takes a React component as an argument.
 */

export function observe<D extends object>(
	store: Observable<any>[]
): <K>(component: K) => K;
export function observe<D extends Document, G extends Store<D>>(
	store: G[]
): <K>(component: K) => K;
export function observe<D extends Document, G extends Store<D>>(
	store: G[] | Observable<any>[]
): <K>(component: K) => K {
	return function (component: any) {
		const originalComponentDidMount =
			component.prototype.componentDidMount || (() => {});

		component.prototype.componentDidMount = function () {
			const unObservers: (() => void)[] = [];
			this.setState({});
			const observer = () => this.setState({});

			store.forEach((singleStore) => {
				if (singleStore instanceof Store) {
					// @ts-ignore
					singleStore.$$observableObject.observe(observer);
					unObservers.push(() =>
						// @ts-ignore
						singleStore.$$observableObject.unobserve(observer)
					);
				}
				if (singleStore instanceof Observable) {
					singleStore.observe(observer);
					unObservers.push(() => singleStore.unobserve(observer));
				} else {
					throw new Error(
						"You're trying to observe something that is not an observable. Please make sure you're passing an instance of Observable or a store"
					);
				}
			});

			const originalComponentWillUnmount =
				this.componentWillUnmount || (() => {});
			this.componentWillUnmount = () => {
				unObservers.forEach((unObserver) => unObserver());
				originalComponentWillUnmount.call(this);
			};

			originalComponentDidMount.call(this);
		};

		return component;
	};
}
