# sostore

Reactive, synchronizing, store and state manager.

## How and why

The goal of this project is to create a unified state management system, that can either be used in front-end frameworks as a state or a store. It also should optionally be persistent and synchronizing across multiple clients.

### Main Functionality

1. To serve as a minimal database (store) on the client side
2. To serve as a state manager for front-end frameworks
3. Optionally persistent
4. Optionally synchronizing to a remote database and other clients
5. Reactive store and state (changes automatically reflected on the front-end framework components).

### Main objectives:

1. Ease of use with least amount of overhead
2. Compatibility with
   - Multiple front-end frameworks
   - Multiple clients (browsers, react-native ...etc)
   - Multiple servers (serverless, CF workers ...etc)
3. Fast and performant
4. Lightweight

## Installation

```
npm install sostore
```

## Usage

### Basic usage as a state manager

```tsx
import { Component } from "react";
import { Observable, observe } from "sostore";

const state = new Observable({
	number: 0,
}).target;

@observe
class App extends Component {
	render() {
		return (
			<button onClick={() => state.number++}>clicked: {state.number}</button>
		);
	}
}

export default App;
```

The state can also live inside the component:

```tsx
import { Component } from "react";
import { Observable, observe } from "sostore";

@observe
class App extends Component {
	// define state inside component
	st = new Observable({ number: 0 }).target;

	// you can also define a computed property
	get clickedBy10() {
		return this.st.number * 10;
	}

	render() {
		return (
			<button
				onClick={() => {
					this.st.number++;
				}}
			>
				clicked: {this.clickedBy10}
			</button>
		);
	}
}
```

[click here for live example](https://stackblitz.com/edit/vitejs-vite-nnntya?file=src%2FApp.tsx)

## Usage as store

```tsx
import { Component } from "react";
import {
	observe,
	Document,
	Store,
	SubDocument,
	mapSubModel,
	IDB,
	CloudFlareApexoDB,
} from "sostore";

// define your models
class Child extends SubDocument {
	name: string = "";
	age: number = 10;
}

class Person extends Document {
	name: string = "";
	// subdocument model
    // and default value as an empty array
	children = mapSubModel(Child, [Child.new()]);
}

// create a store
// all parameters are optional
const myStore = new Store<Person>({
	// define the model to be used for your documents
	model: Person,
	// define encoding/decoding functions
    // to modify data before persistence
	encode: (input) => btoa(input),
	decode: (input) => atob(input),
	// debounce rate is a number in milliseconds
	// is the least amount of time between
    // any two persistence operations
	debounceRate: 500,
	// a callback to be executed
    // when sync has started/ended
	onSyncStart: () => alert("sync has started"),
	onSyncEnd: () => alert("sync has ended"),

	// local persistence layer
	// this example uses IndexedDB
	localPersistence: new IDB({
		name: "mydatabase",
	}),

	// remote persistence layer
	// this example uses a remote persistence layer
	// that has been designed
    // specifically for apexo.app
	remotePersistence: new CloudFlareApexoDB({
		endpoint: "http://myapp.com",
		name: "mydatabase",
		token: "mytoken",
	}),
});



// use your store
@observe
class App extends Component {
	render() {
		return (
			<div>
				<button onClick={() => myStore.add(Person.new())}>Add new child</button>
				{myStore.list.map((person) => (
					<div key={person.id}>
						<pre>{JSON.stringify(person, null, 4)}</pre>
					</div>
				))}
			</div>
		);
	}
}
```

To write your own persistence layer, please refer to: [src/persistence/local.ts](https://github.com/alselawi/sostore/blob/master/src/persistence/local.ts) and [src/persistence/remote.ts](https://github.com/alselawi/sostore/blob/master/src/persistence/remote.ts).


### API: Properties of the store object:

- `.list`: an array of all documents in the store except deleted documents.
- `.copy`: an array of all documents in the store, including deleted documents, however, the array and its objects are not reactive (not observable/reactive).
- `.add`: add document to the store.
- `.get`: get document by id field.
- `.delete`: delete document by given id.
- `.restoreItem`: restore deleted item by given id.
- `.update`: update item fields by given id.
- `.sync`: synchronizes local with remote database.
- `.inSync`: returns `true` if local is in sync with remote, `false` otherwise.
- `loaded`: A promise that would resolve once the store has initially loaded from the local persistence layer (e.g. indexeddb).
- `isOnline`: returns `true` if the remote persistence layer is accessible, `false` otherwise.
- `backup`: returns a backup string that can be used in the restore method below.
- `restore`: restores the store to a specific version defined by the input string (this affect the local and the remote persistence layer, if defined).



#### License: MIT
