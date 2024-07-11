/**
 * Enhances a React component to automatically re-render when the observed store changes.
 * @param store - An instance of Store that extends Document.
 * @returns A higher-order function that takes a React component as an argument.
 */
export function observe(store) {
    return function (component) {
        const originalComponentDidMount = component.prototype.componentDidMount || (() => { });
        component.prototype.componentDidMount = function () {
            const unObservers = [];
            this.setState({});
            const observer = () => this.setState({});
            if (Array.isArray(store)) {
                store.forEach((singleStore) => {
                    // @ts-ignore
                    singleStore.$$observableObject.observe(observer);
                    unObservers.push(() => 
                    // @ts-ignore
                    singleStore.$$observableObject.unobserve(observer));
                });
            }
            else {
                // @ts-ignore
                store.$$observableObject.observe(observer);
                // @ts-ignore
                store.$$observableObject.unobserve(observer);
            }
            const originalComponentWillUnmount = this.componentWillUnmount || (() => { });
            this.componentWillUnmount = () => {
                unObservers.forEach((unObserver) => unObserver());
                originalComponentWillUnmount.call(this);
            };
            originalComponentDidMount.call(this);
        };
        return component;
    };
}
