import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  resolve: {
    alias: { '@': resolve('src') },
  },
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    semi: true,
    trailingComma: 'all',
    singleQuote: true,
    singleAttributePerLine: true,
    bracketSameLine: false,
    bracketSpacing: true,
  },
  lint: {
    plugins: ['eslint', 'oxc', 'unicorn', 'node', 'typescript', 'vitest'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    passWithNoTests: true,
    environment: 'node',
    globals: true,
    reporters: 'verbose',
  },
});
