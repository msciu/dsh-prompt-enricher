/**
 * Build configuration for dsh-prompt-enricher.
 *
 * Two independent artifacts, one toolchain:
 *
 * - `lib/index.js` — the host half. ESM for Node; every `@deepseek-ai/*`
 *   specifier stays an import because a real install materializes them next to
 *   this package in the profile.
 * - `lib/client.js` — the browser half. A closure-factory CJS bundle wrapped in
 *   `window.__ModuleLoader__.load({ id, factory })`, resolving its externals
 *   through the injected `require` (the shell's frozen module table). Only the
 *   platform modules may stay external; anything else must inline, because a
 *   `require` the table cannot answer throws at boot.
 *
 * Plain object, no `defineConfig` import: tsdown accepts a raw config object, and
 * keeping this file import-free means it also builds when the package is linked
 * into a DSH monorepo, where Node would resolve the config's own imports from
 * its real path and miss the monorepo's node_modules.
 *
 * No CSS files: this plugin styles itself through one injected `<style>` tag
 * (see `src/client/styles.ts`), which keeps the build free of a CSS pipeline.
 */

/** Specifiers the shell guarantees in its module table (packages/client/web/src/platform.ts). */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default [
  {
    name: 'dsh-prompt-enricher',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: [/^@deepseek-ai\//] },
  },
  {
    name: 'dsh-prompt-enricher/client',
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    sourcemap: false,
    deps: { neverBundle: PLATFORM_MODULES },
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env.MODE': '"production"',
      'import.meta.env': '{"MODE":"production"}',
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-prompt-enricher", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
