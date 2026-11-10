// ESLint 9 (flat config) – samo pravila bez type-checka radi brzine; strože provjere radi tsc.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.verzije/**', 'site/**', 'prototip/**', 'apps/api/drizzle/**', '**/*.cmd'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // NestJS: `import type` za konstruktorski ubrizgane klase briše metapodatke dekoratora i ruši DI.
  { files: ['apps/api/**/*.ts'], rules: { '@typescript-eslint/consistent-type-imports': 'off' } },
  { files: ['**/scripts/**', '**/*.mjs', '**/e2e/**', '**/cli.ts', 'apps/api/src/main.ts', 'scripts/**'], rules: { 'no-console': 'off' } },
  { files: ['**/*.test.ts'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' }, rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
