import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], globals: false, globalSetup: ['test/setup.ts'], testTimeout: 20000, hookTimeout: 30000 },
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { decoratorMetadata: true, legacyDecorator: true } } })],
});
