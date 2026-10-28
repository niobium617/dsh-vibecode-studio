import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

/**
 * Svelte 5 compiles element locations into `__svelte_meta` in dev only; the
 * production build drops the metadata, which the fallback test asserts.
 */
export default defineConfig({
  plugins: [svelte()],
})
