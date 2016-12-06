import nodeResolve from 'rollup-plugin-node-resolve';

export default {
	entry: 'register/index.js',
	dest: 'register.js',
	format: 'cjs',
	external: [ 'svelte' ],
	plugins: [
		nodeResolve({
			jsnext: true,
			module: true
		})
	]
};
