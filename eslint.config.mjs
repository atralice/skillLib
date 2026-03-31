import nextTypescript from "eslint-config-next/typescript";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import jestPlugin from "eslint-plugin-jest";
import noLoopsPlugin from "eslint-plugin-no-loops";
import noOnlyTestsPlugin from "eslint-plugin-no-only-tests";
import tseslint from "typescript-eslint";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  ...nextTypescript,
  ...nextCoreWebVitals,
  ...tseslint.configs.recommended,
  {
    ignores: [
      ".next/**",
      ".next-playwright/**",
      ".trigger/**",
      "generated/prisma/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'Program[body.0.directive="use server"] > ExportNamedDeclaration[declaration.type!="FunctionDeclaration"][declaration.type!="TSDeclareFunction"]',
          message:
            "Files with 'use server' can only export async functions. Move non-function exports (schemas, types, constants) to a separate file without 'use server'.",
        },
        {
          selector:
            'Program[body.0.directive="use server"] > ExportNamedDeclaration > VariableDeclaration',
          message:
            "Files with 'use server' can only export async functions. Move variable exports (schemas, constants) to a separate file without 'use server'.",
        },
      ],
      "react-hooks/exhaustive-deps": "error",
      "@next/next/no-img-element": "off",
      "react/jsx-boolean-value": ["error", "never"],
      "no-unused-vars": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-empty-function": [
        "error",
        { allow: ["arrowFunctions"] },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "never",
        },
      ],
      "react/no-unknown-property": [
        2,
        {
          ignore: ["jsx", "global"],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    plugins: {
      jest: jestPlugin,
      "no-only-tests": noOnlyTestsPlugin,
      "no-loops": noLoopsPlugin,
    },
    settings: {
      jest: {
        globalPackage: "bun:test",
        version: 29,
      },
    },
    rules: {
      ...jestPlugin.configs.recommended.rules,
      "no-only-tests/no-only-tests": "error",
      "jest/consistent-test-it": ["error", { fn: "test" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message:
            "Dynamic `import(...)` is not allowed. Prefer static `import ... from ...`.",
        },
        {
          selector: "IfStatement",
          message: "Do not use if/else in tests.",
        },
        {
          selector: "TryStatement",
          message: "Do not use try/catch in tests.",
        },
        {
          selector: "ThrowStatement",
          message:
            "`throw` is not allowed in test files. Use `expectDefined` / `expectDefinedNotNull` instead.",
        },
        {
          selector:
            "CallExpression[callee.object.name='mock'][callee.property.name='module']",
          message: "Do not use mock.module().",
        },
      ],
      "no-loops/no-loops": "error",
      "no-process-env": "error",
    },
  },
  {
    files: ["**/*.test.tsx"],
    plugins: {
      jest: jestPlugin,
      "no-only-tests": noOnlyTestsPlugin,
      "no-loops": noLoopsPlugin,
    },
    settings: {
      jest: {
        globalPackage: "bun:test",
        version: 29,
      },
    },
    rules: {
      ...jestPlugin.configs.recommended.rules,
      "no-only-tests/no-only-tests": "error",
      "jest/consistent-test-it": ["error", { fn: "test" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "IfStatement",
          message: "Do not use if/else in tests.",
        },
        {
          selector: "TryStatement",
          message: "Do not use try/catch in tests.",
        },
        {
          selector: "ThrowStatement",
          message:
            "`throw` is not allowed in test files. Use `expectDefined` / `expectDefinedNotNull` instead.",
        },
      ],
      "no-loops/no-loops": "error",
      "no-process-env": "error",
    },
  },
  {
    files: ["**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.spec.ts", "test/e2e/testHelpers/**/*.ts", "test/testHelpers/**/*.ts", "test/customMatchers/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message:
            "Dynamic `import(...)` is not allowed. Prefer static `import ... from ...`.",
        },
        {
          selector: 'CallExpression[callee.name="expect"]',
          message: "`expect` is not allowed in non-test files.",
        },
      ],
    },
  },
];

export default eslintConfig;
