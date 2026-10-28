import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Inspector from 'vite-plugin-vue-inspector'

/**
 * `vite-plugin-vue-inspector` records element positions on vnodes in dev
 * (`apply: 'serve'`), the path the T029 Vue adapter reads. A production build
 * carries no metadata, which the fallback test asserts.
 */
export default defineConfig({
  plugins: [vue(), Inspector()],
})
