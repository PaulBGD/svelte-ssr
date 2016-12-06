import { parse, validate } from 'svelte';
import { walk } from 'estree-walker';
import deindent from './utils/deindent.js';
import isReference from './utils/isReference.js';
import flattenReference from './utils/flattenReference.js';
import MagicString from 'magic-string';

const voidElementNames = /^(?:area|base|br|col|command|doctype|embed|hr|img|input|keygen|link|meta|param|source|track|wbr)$/i;

export default function compile ( source, filename ) {
	const parsed = parse( source, {} );
	validate( parsed, source, {} );

	const code = new MagicString( source );

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
			const { string } = contextualise( node.expression ); // TODO use snippet, for sourcemap support

			scope = new Set();
			scope.add( node.context );
			if ( node.index ) scope.add( node.index );

			scopes.push( scope );

			const block = `\${ ${string}.map( ${ node.index ? `( ${node.context}, ${node.index} )` : node.context} => \`${ node.children.map( stringify ).join( '' )}\` ).join( '' )}`;

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

						const { string } = contextualise( chunk.expression ); // TODO use snippet, for sourcemap support
						return '${' + string + '}';
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
			const { string } = contextualise( node.expression ); // TODO use snippet, for sourcemap support

			const consequent = node.children.map( stringify ).join( '' );
			const alternate = node.else ? node.else.children.map( stringify ).join( '' ) : '';

			return '${ ' + string + ' ? `' + consequent + '` : `' + alternate + '` }'
		},

		MustacheTag ( node ) {
			const { string } = contextualise( node.expression ); // TODO use snippet, for sourcemap support
			return '${' + string + '}';
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

	const render = deindent`
		exports.render = function ( data ) {
			var rendered = '';

			${blocks.join( '\n\n' )}

			return rendered;
		};
	`;

	return {
		code: render
	};
}
