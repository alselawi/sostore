export function observe(store) {
    return function (component) {
        let oCDM = component.prototype.componentDidMount || (() => { });
        component.prototype.componentDidMount = function () {
            let unObservers = [];
            this.setState({});
            const observer = () => this.setState({});
            store.$$observableObject.observe(observer);
            unObservers.push(() => store.$$observableObject.unobserve(observer));
            const oCWU = this.componentWillUnmount || (() => { });
            this.componentWillUnmount = () => {
                unObservers.forEach((u) => u());
                oCWU.call(this);
            };
            oCDM.call(this);
        };
        return component;
    };
}
