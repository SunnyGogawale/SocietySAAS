import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactNative from 'eslint-plugin-react-native';

const jsxParserOptions = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  ecmaFeatures: { jsx: true },
};

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'apps/mobile/.expo/**'],
  },
  js.configs.recommended,
  {
    files: ['apps/web/**/*.{js,jsx}', 'apps/mobile/**/*.{js,jsx}'],
    languageOptions: {
      parserOptions: jsxParserOptions,
      globals: globals.es2021,
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{js,jsx}', 'apps/mobile/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/mobile/**/*.{js,jsx}'],
    plugins: { 'react-native': reactNative },
    languageOptions: { globals: { process: 'readonly' } },
    rules: {
      'react-native/no-unused-styles': 'warn',
      'react-native/no-inline-styles': 'off',
      'react-native/no-single-element-style-arrays': 'error',
    },
  },
  {
    files: ['apps/backend/**/*.js', 'eslint.config.js', 'packages/**/*.js', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/backend/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: ['**/*.test.js', '**/*.test.jsx'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
        ...globals.browser,
      },
    },
  },
];
