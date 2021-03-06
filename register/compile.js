import { parse, validate } from 'svelte';
import { walk } from 'estree-walker';
import deindent from './utils/deindent.js';
import isReference from './utils/isReference.js';
import flattenReference from './utils/flattenReference.js';
import MagicString, { Bundle } from 'magic-string';

const voidElementNames = /^(?:area|base|br|col|command|doctype|embed|hr|img|input|keygen|link|meta|param|source|track|wbr)$/i;

export default function compile ( source, filename ) {
	const parsed = parse( source, {} );
	validate( parsed, source, {} );

	const code = new MagicString( source );

	const templateProperties = {};
	const components = {};
	const helpers = {};

	const imports = [];

	if ( parsed.js ) {
		walk( parsed.js.content, {
			enter ( node ) {
				code.addSourcemapLocation( node.start );
				code.addSourcemapLocation( node.end );
			}
		});

		// imports need to be hoisted out of the IIFE
		for ( let i = 0; i < parsed.js.content.body.length; i += 1 ) {
			const node = parsed.js.content.body[i];
			if ( node.type === 'ImportDeclaration' ) {
				let a = node.start;
				let b = node.end;
				while ( /[ \t]/.test( source[ a - 1 ] ) ) a -= 1;
				while ( source[b] === '\n' ) b += 1;

				//imports.push( source.slice( a, b ).replace( /^\s/, '' ) );
				imports.push( node );
				code.remove( a, b );
			}
		}

		const defaultExport = parsed.js.content.body.find( node => node.type === 'ExportDefaultDeclaration' );

		if ( defaultExport ) {
			const finalNode = parsed.js.content.body[ parsed.js.content.body.length - 1 ];
			if ( defaultExport === finalNode ) {
				// export is last property, we can just return it
				code.overwrite( defaultExport.start, defaultExport.declaration.start, `return ` );
			} else {
				// TODO ensure `template` isn't already declared
				code.overwrite( defaultExport.start, defaultExport.declaration.start, `var template = ` );

				let i = defaultExport.start;
				while ( /\s/.test( source[ i - 1 ] ) ) i--;

				const indentation = source.slice( i, defaultExport.start );
				code.appendLeft( finalNode.end, `\n\n${indentation}return template;` );
			}

			defaultExport.declaration.properties.forEach( prop => {
				templateProperties[ prop.key.name ] = prop.value;
			});

			code.prependRight( parsed.js.content.start, 'var template = (function () {' );
		} else {
			code.prependRight( parsed.js.content.start, '(function () {' );
		}

		code.appendLeft( parsed.js.content.end, '}());' );

		if ( templateProperties.helpers ) {
			templateProperties.helpers.properties.forEach( prop => {
				helpers[ prop.key.name ] = prop.value;
			});
		}

		if ( templateProperties.components ) {
			templateProperties.components.properties.forEach( prop => {
				components[ prop.key.name ] = prop.value;
			});
		}
	}

	let scope = new Set();
	const scopes = [ scope ];

	function contextualise ( expression ) {
		walk( expression, {
			enter ( node, parent ) {
				if ( isReference( node, parent ) ) {
					const { name } = flattenReference( node );

					if ( parent && parent.type === 'CallExpression' && node === parent.callee && helpers[ name ] ) {
						code.prependRight( node.start, `template.helpers.` );
						return;
					}

					if ( !scope.has( name ) ) {
						code.prependRight( node.start, `data.` );
					}

					this.skip();
				}
			}
		});

		return {
			snippet: `[✂${expression.start}-${expression.end}✂]`,
			string: code.slice( expression.start, expression.end )
		};
	}

	const stringifiers = {
		EachBlock ( node ) {
			const { snippet } = contextualise( node.expression );

			scope = new Set();
			scope.add( node.context );
			if ( node.index ) scope.add( node.index );

			scopes.push( scope );

			const block = `\${ ${snippet}.map( ${ node.index ? `( ${node.context}, ${node.index} )` : node.context} => \`${ node.children.map( stringify ).join( '' )}\` ).join( '' )}`;

			scopes.pop();
			scope = scopes[ scopes.length - 1 ];

			return block;
		},

		Element ( node ) {
			let element = `<${node.name}`;

			node.attributes.forEach( attribute => {
				let str = ` ${attribute.name}`;

				if ( attribute.value !== true ) {
					str += `="` + attribute.value.map( chunk => {
						if ( chunk.type === 'Text' ) {
							return chunk.data;
						}

						const { snippet } = contextualise( chunk.expression );
						return '${' + snippet + '}';
					}).join( '' ) + `"`;
				}

				element += str;
			});

			if ( voidElementNames.test( node.name ) ) {
				element += '>';
			} else if ( node.children.length === 0 ) {
				element += '/>';
			} else {
				element += '>' + node.children.map( stringify ).join( '' ) + `</${node.name}>`;
			}

			return element;
		},

		IfBlock ( node ) {
			const { snippet } = contextualise( node.expression ); // TODO use snippet, for sourcemap support

			const consequent = node.children.map( stringify ).join( '' );
			const alternate = node.else ? node.else.children.map( stringify ).join( '' ) : '';

			return '${ ' + snippet + ' ? `' + consequent + '` : `' + alternate + '` }';
		},

		MustacheTag ( node ) {
			const { snippet } = contextualise( node.expression ); // TODO use snippet, for sourcemap support
			return '${' + snippet + '}';
		},

		Text ( node ) {
			return node.data.replace( /\${/g, '\\${' );
		}
	};

	function stringify ( node ) {
		const stringifier = stringifiers[ node.type ];

		if ( !stringifier ) {
			throw new Error( `Not implemented: ${node.type}` );
		}

		return stringifier( node );
	}

	function createBlock ( node ) {
		const str = stringify( node );
		if ( str.slice( 0, 2 ) === '${' ) return str.slice( 2, -1 );
		return '`' + str + '`';
	}

	const blocks = parsed.html.children.map( node => {
		return deindent`
			rendered += ${createBlock( node )};
		`;
	});

	const topLevelStatements = [];

	const importBlock = imports
		.map( ( declaration, i ) => {
			const defaultImport = declaration.specifiers.find( x => x.type === 'ImportDefaultSpecifier' || x.type === 'ImportSpecifier' && x.imported.name === 'default' );
			const namespaceImport = declaration.specifiers.find( x => x.type === 'ImportNamespaceSpecifier' );
			const namedImports = declaration.specifiers.filter( x => x.type === 'ImportSpecifier' && x.imported.name !== 'default' );

			const name = ( defaultImport || namespaceImport ) ? ( defaultImport || namespaceImport ).local.name : `__import${i}`;

			const statements = [
				`var ${name} = require( '${declaration.source.value}' );`
			];

			namedImports.forEach( specifier => {
				statements.push( `var ${specifier.local.name} = ${name}.${specifier.imported.name};` );
			});

			if ( defaultImport ) {
				statements.push( `${name} = ( ${name} && ${name}.__esModule ) ? ${name}['default'] : ${name};` );
			}

			return statements.join( '\n' );
		})
		.filter( Boolean )
		.join( '\n' );

	if ( parsed.js ) {
		if ( imports.length ) {
			topLevelStatements.push( importBlock );
		}

		topLevelStatements.push( `[✂${parsed.js.content.start}-${parsed.js.content.end}✂]` );
	}

	if ( parsed.css ) {
		throw new Error( 'TODO handle css' );
	}

	topLevelStatements.push( deindent`
		exports.render = function ( data ) {
			${ templateProperties.data ? `data = Object.assign( template.data(), data || {} );` : `data = data || {};` }
			var rendered = '';

			${blocks.join( '\n\n' )}

			return rendered;
		};
	` );

	const rendered = topLevelStatements.join( '\n\n' );

	const pattern = /\[✂(\d+)-(\d+)$/;

	const parts = rendered.split( '✂]' );
	const finalChunk = parts.pop();

	const compiled = new Bundle({ separator: '' });

	function addString ( str ) {
		compiled.addSource({
			content: new MagicString( str )
		});
	}

	parts.forEach( str => {
		const chunk = str.replace( pattern, '' );
		if ( chunk ) addString( chunk );

		const match = pattern.exec( str );

		const snippet = code.snip( +match[1], +match[2] );

		compiled.addSource({
			filename,
			content: snippet
		});
	});

	addString( finalChunk );

	return {
		code: compiled.toString()
	};
}
