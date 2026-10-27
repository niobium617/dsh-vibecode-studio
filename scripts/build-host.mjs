/**
 * Builds the host half to ESM at `lib/index.js` (plan D2).
 *
 * Relative modules are inlined; runtime packages stay external so a profile
 * install resolves them from its own node_modules. The output is imported once
 * after the build so a malformed ESM entry fails here rather than inside DSH.
 */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const entry = join(root, 'src/host/index.ts')
const outfile = join(root, 'lib/index.js')

await mkdir(dirname(outfile), { recursive: true })

const result = await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  packages: 'external',
  logLevel: 'warning',
  metafile: true,
})

const bytes = Object.values(result.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0)
console.log(`built ${relative(root, outfile)} (${(bytes / 1024).toFixed(1)} KiB)`)

await import(pathToFileURL(outfile).href)
console.log('host entry imports cleanly')
