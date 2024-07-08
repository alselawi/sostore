import { Document } from "./model";
import { Store } from "./store";

export function observe<D extends Document, G extends Store<D>>(
	store: G
): (component: any) => any {
	return function (component: any) {
		let oCDM = component.prototype.componentDidMount || (() => {});
		component.prototype.componentDidMount = function () {
            let unObservers: (() => void)[] = [];
            this.setState({});
            const observer = () => this.setState({});
            (store as any).$$observableObject.observe(observer);
            unObservers.push(() => (store as any).$$observableObject.unobserve(observer));
            const oCWU = this.componentWillUnmount || (() => {});
            this.componentWillUnmount = () => {
                unObservers.forEach((u) => u());
                oCWU.call(this);
            }
			oCDM.call(this);
		};
        return component;
	};
}
