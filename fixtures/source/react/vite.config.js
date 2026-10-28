import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { transformSync } from '@babel/core'
import { InspectorBabelPlugin } from '@react-dev-inspector/babel-plugin'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * React 19 dropped the runtime `_debugSource`, so element positions are baked
 * into JSX at build time by `@react-dev-inspector/babel-plugin`, exactly like
 * the S4 spike (`spikes/s4/fixtures/react/vite.config.js`).
 *
 * Dev-only (`apply: 'serve'`): a production build carries no source
 * metadata, which is what the T029 fallback test asserts.
 */
function inspectorSource() {
  return {
    name: 'vibe-source:react-inspector-source',
    enforce: 'pre',
    apply: 'serve',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file || file.startsWith('\0') || file.includes('/node_modules/')) return null
      if (!/\.jsx?$/.test(file)) return null
      const result = transformSync(code, {
        filename: file,
        cwd: root,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        parserOpts: { plugins: ['jsx'], sourceType: 'module' },
        plugins: [[InspectorBabelPlugin, { cwd: root }]],
      })
      if (!result?.code) return null
      return { code: result.code, map: result.map }
    },
  }
}

export default defineConfig({
  plugins: [inspectorSource(), react()],
})
