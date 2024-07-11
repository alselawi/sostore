# Apical-Store

Example workflow
```typescript
import { Document, Store, SubDocument, mapSubModel, observe } from "apical-store";

class Department extends SubDocument {
    name: string = "";
}

class Employee extends Document {
    name: string = "";
    age: number = 0;
    department = mapSubModel(Department, {
        name: "sales"
    });
}


const myStore = new Store<Employee>({
    name: "my-store", // remote table name and local indexedDB
    model: Employee,
    persist: true,
    endpoint: "http://api.myendpoint.com",
    token: "my-token",
    debounceRate: 1000,
    encode: (data: any) => JSON.stringify(data),
    decode: (data: string) => JSON.parse(data)
});

@observe(myStore)
class MyComponent extends React.Component {
    render() {
        return <div>
            {myStore.list.map(x=>JSON.stringify(x))}
        </div>;
    }
}
```