// eslint.config.mjs — PG strict baseline (2026-09-05).
// Zrodla: hono / zod / TanStack Query (audyt wzorcow A6), Google "What to look for in a code review",
// Ousterhout (zlozonosc = zaleznosci + obscurity), Kernighan (sprytny kod = 2x trudniejszy w debugowaniu).
// Zasada: bramka mierzy to, co da sie zmierzyc (rozmiar, zlozonosc, nazwy, obietnice, wyczerpujacy switch);
// osad (design, DLACZEGO w komentarzach) zostaje dla pg-review.
// Wymagane: eslint >= 9, typescript-eslint >= 8, @eslint/js, globals. Opcjonalne (wykrywane): eslint-plugin-react-hooks,
// eslint-plugin-react-refresh, @vitest/eslint-plugin, eslint-plugin-jsdoc.
// UWAGA: reguly z typami (strictTypeChecked) potrzebuja tsconfig z "include" pokrywajacym lintowane pliki.
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const optional = async (name) => {
  try { const m = await import(name); return m.default ?? m; } catch { return null; }
};
const reactHooks = await optional('eslint-plugin-react-hooks');
const reactRefresh = await optional('eslint-plugin-react-refresh');
const vitest = await optional('@vitest/eslint-plugin');
const jsdoc = await optional('eslint-plugin-jsdoc');

// Progi czytelnosci — z audytu floty 2026-09-05 (NewOrderWizard 2174 linii, 207 funkcji > 60 linii w jednym repo).
const MAX_FUNCTION_LINES = 60;
const MAX_FILE_LINES = 400;
const MAX_NESTING_DEPTH = 3;
const MAX_PARAMS = 4;
const MAX_CYCLOMATIC = 10;
const MIN_IDENTIFIER_LENGTH = 2;
const IDENTIFIER_EXCEPTIONS = ['i', 'j', 'k', 'x', 'y', 'z', '_', 'e', 't', 'id', 'db', 'fn', 'cb', 'el', 'ev', 'ok'];
const MAGIC_NUMBER_ALLOWLIST = [-1, 0, 1, 2, 10, 100, 1000];

const readabilityRules = {
  complexity: ['error', MAX_CYCLOMATIC],
  'max-depth': ['error', MAX_NESTING_DEPTH],
  'max-params': ['error', MAX_PARAMS],
  'max-lines': ['error', { max: MAX_FILE_LINES, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true, IIFEs: true }],
  'max-classes-per-file': ['error', 1],
  'id-length': ['error', { min: MIN_IDENTIFIER_LENGTH, exceptions: IDENTIFIER_EXCEPTIONS, properties: 'never' }],
  'no-magic-numbers': ['warn', { ignore: MAGIC_NUMBER_ALLOWLIST, ignoreArrayIndexes: true, ignoreDefaultValues: true, enforceConst: true, detectObjects: false }],
  'no-param-reassign': ['error', { props: false }],
  'prefer-const': 'error',
  'no-nested-ternary': 'error',
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-restricted-syntax': [
    'error',
    { selector: 'ClassDeclaration[superClass][superClass.name!=/Error$/]', message: 'Dziedziczenie tylko po Error (pg/paradigm.md: kompozycja > dziedziczenie).' },
    { selector: 'TSEnumDeclaration', message: 'Uzyj unii literalow (`type X = "a" | "b"`) zamiast enum.' },
  ],
};

const typeRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
  '@typescript-eslint/require-await': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
  '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
  '@typescript-eslint/no-import-type-side-effects': 'error',
  '@typescript-eslint/no-unnecessary-condition': 'warn',
  '@typescript-eslint/restrict-template-expressions': ['warn', { allowNumber: true, allowBoolean: true }],
  '@typescript-eslint/naming-convention': [
    'error',
    { selector: 'variableLike', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
    { selector: 'typeLike', format: ['PascalCase'] },
    { selector: 'property', format: null }, // klucze z API/DB (snake_case) nie sa nasze
  ],
};

const optionalPlugins = {
  ...(reactHooks ? { 'react-hooks': reactHooks } : {}),
  ...(reactRefresh ? { 'react-refresh': reactRefresh } : {}),
  ...(jsdoc ? { jsdoc } : {}),
};
const optionalRules = {
  ...(reactHooks ? reactHooks.configs.recommended.rules : {}),
  ...(reactRefresh ? { 'react-refresh/only-export-components': ['warn', { allowConstantExport: true }] } : {}),
  // TSDoc tylko na eksportach (A6: wzorcowe repo nie dokumentuja wszystkiego) — warn, zeby nie karmic szumu.
  ...(jsdoc ? { 'jsdoc/require-jsdoc': ['warn', { publicOnly: true, require: { FunctionDeclaration: true, ArrowFunctionExpression: false, FunctionExpression: false } }] } : {}),
};

export default tseslint.config(
  { ignores: ['dist', 'build', 'coverage', '.next', '.vercel', 'node_modules', '**/*.gen.ts', '**/*.d.ts'] },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)) },
    },
    plugins: optionalPlugins,
    rules: { ...readabilityRules, ...typeRules, ...optionalRules },
  },
  {
    // Testy: asercje na zachowaniu, spojne `it`, zero testow bez expect; `any` dozwolone (fixture'y).
    files: ['**/*.{test,spec}.{ts,tsx}', 'e2e/**/*.ts', 'src/test/**/*.ts'],
    ...(vitest ? { plugins: { vitest } } : {}),
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      ...(vitest ? { 'vitest/consistent-test-it': ['error', { fn: 'it' }], 'vitest/no-standalone-expect': 'error', 'vitest/expect-expect': 'error' } : {}),
    },
  },
  {
    // Edge functions (Deno): brak react-refresh, konsola to jedyny log.
    files: ['supabase/functions/**/*.ts'],
    rules: { 'react-refresh/only-export-components': 'off', 'no-console': 'off' },
  },
);
