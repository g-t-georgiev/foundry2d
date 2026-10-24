// eslint.config.mjs
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default defineConfig([
  // Register ignored files and directories
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.cache/**",
      "eslint.config.mjs",
    ],
  },

  // Register Global JavaScript Defaults
  js.configs.recommended,

  // Register Global TypeScript Engines & Recommended Rules
  // This automatically sets up parsing for .ts, .tsx, .mts, etc.
  ...tseslint.configs.recommendedTypeChecked,

  // Project-wide TypeScript/JavaScript rules
  {
    files: ["**/*.{ts,mjs}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked, // Deep semantic linting
    ],
    rules: {
      // Disallow unused variables, but allow prefixing with underscore (e.g. `_coords`)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow explicit `any` when prototyping low-level buffers, but warn
      "@typescript-eslint/no-explicit-any": "warn",
      // Enforce clean ES module imports
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/quotes": ["error", "double", { avoidEscape: true }],
      quotes: ["error", "double", { avoidEscape: true }],
    },
  },

  // Example ruleset override per project
  // {
  //   files: ["apps/pixel-editor/**/*.{ts}"],
  //   rules: {
  //     "@typescript-eslint/no-explicit-any": "warn",
  //   },
  // },

  eslintConfigPrettier,
]);
