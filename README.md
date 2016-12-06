# svelte-ssr

Server-side rendering for [Svelte](https://svelte.technology) components. Work-in-progress

## Installation

```bash
npm install --save svelte-ssr
```

## Usage

```js
require( 'svelte-ssr/register' );
const component = require( './components/MyComponent.html' );

const html = component.render({
  foo: 'bar'
});
```

Note that components are not stateful – you must pass in all the data you need for each render.

## License

[MIT](LICENSE)
