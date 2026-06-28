import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
	js.configs.recommended,
	...ts.configs.recommended,

	{
		languageOptions: {
			globals: {
				...globals.node,
				...globals.browser,
				NodeJS: 'readonly',
				Bun: 'readonly'
			}
		},
		rules: {
			// `any` is used deliberately at the runtime boundary (Bun globals,
			// optional bun-pty/node-pty modules loaded by dynamic import, xterm
			// addon shapes, framework adapter payloads).
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
			],
			'no-empty': ['error', { allowEmptyCatch: true }],
			'prefer-const': 'error'
		}
	},

	{
		ignores: ['dist/', 'examples/', 'bench/']
	}
];
