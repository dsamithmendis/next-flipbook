// One flat config for the whole repository. `npm run lint` runs it with --max-warnings 0, so a
// finding is either fixed or turned off here with a reason: there are no inline disables to hunt for.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/.next/**",
    "**/coverage/**",
    "**/node_modules/**",
    "**/next-env.d.ts",
    "**/playwright-report/**",
    "**/test-results/**",
    "demo/next-app/public/**",
  ]),

  js.configs.recommended,

  // TypeScript, with type information, so that floating promises and the like are caught.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // An async function with no await is deliberate here: it never throws synchronously, and the
      // test fakes implement Promise-returning interfaces with plain values.
      "@typescript-eslint/require-await": "off",
      // The library never writes to the console. Warnings and errors are reported through
      // onError and FlipBookError, not logged.
      "no-console": "error",
    },
  },

  // Plain JavaScript (scripts, benchmarks, configs) has no type information to use.
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  // The browser benchmark sends functions into the page, where `window` and `document` exist.
  {
    files: ["benchmarks/browser.mjs"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["benchmarks/**/*.mjs", "e2e/**/*.ts", "demo/next-app/scripts/**/*.mjs", "packages/flipbook/scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },

  // React: hooks rules everywhere a component or hook lives.
  {
    files: ["packages/flipbook/src/react/**/*.{ts,tsx}", "demo/next-app/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["packages/flipbook/src/**/*.ts", "packages/flipbook/tests/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["packages/flipbook/tests/**/*.{ts,tsx}", "e2e/**/*.ts"],
    rules: {
      // Tests hold on to a handle, assert it exists and call into it, and stub browser
      // methods with partial objects. Typing every stub in full would bury what is tested.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
]);
