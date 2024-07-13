import { uuid } from "./uuid";
export const observingComponents = {};
/**
 * Enhances a React component to automatically re-render when the observed store changes.
 * @param store - An instance of Store that extends Document.
 * @returns A higher-order function that takes a React component as an argument.
 */
export function observe(component) {
    const oComponentDidMount = component.prototype.componentDidMount || (() => { });
    component.prototype.componentDidMount = function () {
        this.setState({});
        this.$$observerID = uuid();
        observingComponents[this.$$observerID] = () => this.setState({});
        const oComponentWillUnmount = this.componentWillUnmount || (() => { });
        this.componentWillUnmount = () => {
            delete observingComponents[this.$$observerID];
            oComponentWillUnmount.call(this);
        };
        oComponentDidMount.call(this);
    };
    return component;
}
