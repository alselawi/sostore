import { uuid } from "./uuid";

export const observingComponents: Record<string, () => void> = {};

/**
 * Enhances a React component to automatically re-render when the observed store changes.
 * @param store - An instance of Store that extends Document.
 * @returns A higher-order function that takes a React component as an argument.
 */
export function observe<K extends object>(component: K): K {
	const oComponentDidMount =
		(component as any).prototype.componentDidMount || (() => {});
	(component as any).prototype.componentDidMount = function () {
		this.setState({});

		this.$$observerID = uuid();
		observingComponents[this.$$observerID] = () => this.setState({});

		const oComponentWillUnmount =
			this.componentWillUnmount || (() => {});
		this.componentWillUnmount = () => {
			delete observingComponents[this.$$observerID];
			oComponentWillUnmount.call(this);
		};
		oComponentDidMount.call(this);
	};
	return component;
}
