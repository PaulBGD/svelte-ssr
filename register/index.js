import * as fs from 'fs';
import compile from './compile.js';

const cache = {};

require.extensions[ '.html' ] = function ( module, filename ) {
	const code = cache[ filename ] || ( cache[ filename ] = compile( fs.readFileSync( filename, 'utf-8' ) ).code );

	try {
		return module._compile( code, filename );
	} catch ( err ) {
		console.log( code );
		throw err;
	}
};
