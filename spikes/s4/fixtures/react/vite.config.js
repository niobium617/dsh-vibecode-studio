import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { transformSync } from '@babel/core'
import { InspectorBabelPlugin } from '@react-dev-inspector/babel-plugin'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * React 19 dropped `_debugSource` at runtime, so source positions must be
 * baked into JSX at build time, like vite-plugin-vue-inspector does for Vue.
 * Dev-only; the plugin options are documented at
 * https://react-dev-inspector.zthxxx.me/docs/compiler-plugin
 */
function inspectorSource() {
  return {
    name: 's4:react-inspector-source',
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
