// ESLint 9 flat config (CommonJS for this project)
// Mirrors previous .eslintrc.json with TypeScript support

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const js = require('@eslint/js');

module.exports = [
  // Base JS recommended rules
  js.configs.recommended,
  // TypeScript rules for .ts files
  {
    files: ['**/*.ts'],
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/__tests__/**',
      'src/test/**',
      'src/scripts/**',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        global: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Prefer explicit intent for unused parameters and caught errors per ADR
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_ignored',
          varsIgnorePattern: '^_',
        },
      ],
      'no-unused-vars': 'off',
      'no-undef': 'off',
      // Allow intentionally empty catch with an intent comment (ADR: allowEmptyCatch)
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unreachable': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      // Prefer @ts-expect-error; keep as warn to avoid CI break while migrating
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        {
          'ts-ignore': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 3,
        },
      ],
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Looser rules for framework adapters and config (controllers/routes/analysis/config)
  {
    files: [
      'src/controllers/**/*.ts',
      'src/routes/**/*.ts',
      'src/analysis/**/*.ts',
      'src/config/**/*.ts',
    ],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-console': 'off',
    },
  },
  // Relax unused vars in utils
  {
    files: [
      'src/utils/**/*.ts',
    ],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
];
