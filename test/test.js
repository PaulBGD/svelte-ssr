import assert from 'assert';
import * as fs from 'fs';
import jsdom from 'jsdom';
import '../register.js';

import * as consoleGroup from 'console-group';
consoleGroup.install();

import * as sourceMapSupport from 'source-map-support';
sourceMapSupport.install();

function exists ( path ) {
	try {
		fs.statSync( path );
		return true;
	} catch ( err ) {
		return false;
	}
}

function env () {
	return new Promise( ( fulfil, reject ) => {
		jsdom.env( '<main></main>', ( err, window ) => {
			if ( err ) {
				reject( err );
			} else {
				global.document = window.document;
				fulfil( window );
			}
		});
	});
}

function tryToLoadJson ( file ) {
	try {
		return JSON.parse( fs.readFileSync( file ) );
	} catch ( err ) {
		if ( err.code !== 'ENOENT' ) throw err;
		return null;
	}
}

describe( 'svelte-ssr', () => {
	before( () => {
		function cleanChildren ( node ) {
			let previous = null;

			[ ...node.childNodes ].forEach( child => {
				if ( child.nodeType === 8 ) {
					// comment
					node.removeChild( child );
					return;
				}

				if ( child.nodeType === 3 ) {
					child.data = child.data.replace( /\s{2,}/, '\n' );

					// text
					if ( previous && previous.nodeType === 3 ) {
						previous.data += child.data;
						previous.data = previous.data.replace( /\s{2,}/, '\n' );

						node.removeChild( child );
					}
				}

				else {
					cleanChildren( child );
				}

				previous = child;
			});

			// collapse whitespace
			if ( node.firstChild && node.firstChild.nodeType === 3 ) {
				node.firstChild.data = node.firstChild.data.replace( /^\s+/, '' );
				if ( !node.firstChild.data ) node.removeChild( node.firstChild );
			}

			if ( node.lastChild && node.lastChild.nodeType === 3 ) {
				node.lastChild.data = node.lastChild.data.replace( /\s+$/, '' );
				if ( !node.lastChild.data ) node.removeChild( node.lastChild );
			}
		}

		return env().then( window => {
			assert.htmlEqual = ( actual, expected, message ) => {
				window.document.body.innerHTML = actual.trim();
				cleanChildren( window.document.body, '' );
				actual = window.document.body.innerHTML;

				window.document.body.innerHTML = expected.trim();
				cleanChildren( window.document.body, '' );
				expected = window.document.body.innerHTML;

				assert.deepEqual( actual, expected, message );
			};
		});
	});

	fs.readdirSync( 'test/samples' ).forEach( dir => {
		if ( dir[0] === '.' ) return;

		const solo = exists( `test/samples/${dir}/solo` );

		( solo ? it.only : it )( dir, () => {
			const component = require( `./samples/${dir}/main.html` );

			const expected = fs.readFileSync( `test/samples/${dir}/_expected.html`, 'utf-8' );

			const data = tryToLoadJson( `test/samples/${dir}/data.json` );
			const actual = component.render( data );

			fs.writeFileSync( `test/samples/${dir}/_actual.html`, actual );

			assert.htmlEqual( actual, expected );
		});
	});
});
