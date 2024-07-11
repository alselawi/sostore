# Apical-Store

Example workflow
```typescript
import { Document, Store, SubDocument, mapSubModel, observe, CloudFlareApexoDB, IDB } from "apical-store";

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
    localPersistance: new IDB({
        name: "my-database"
    }),
    remotePersistence: new CloudFlareApexoDB({
        endpoint: "http://someurl",
        token: "token",
        name: "my-database",
    }),
    model: Employee,
    debounceRate: 1000,
    encode: (data: any) => JSON.stringify(data),
    decode: (data: string) => JSON.parse(data)
});

@observe([myStore])
class MyComponent extends React.Component {
    render() {
        return <div>
            {myStore.list.map(x=>JSON.stringify(x))}
        </div>;
    }
}
```