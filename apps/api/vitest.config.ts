import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], globals: false },
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { decoratorMetadata: true, legacyDecorator: true } } })],
});
