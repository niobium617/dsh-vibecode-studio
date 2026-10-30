/**
 * Builds the host half to ESM: `lib/index.js` (plan D2) and `lib/agent.js`
 * (T052, the `Vibe Studio` preset's agent-plane entry).
 *
 * Relative modules are inlined; runtime packages stay external so a profile
 * install resolves them from its own node_modules. Every output is imported
 * once after the build so a malformed ESM entry fails here rather than inside
 * DSH.
 */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const entries = [
  { entry: join(root, 'src/host/index.ts'), outfile: join(root, 'lib/index.js') },
  { entry: join(root, 'src/host/agent/preset.ts'), outfile: join(root, 'lib/agent.js') },
]

await mkdir(join(root, 'lib'), { recursive: true })

for (const { entry, outfile } of entries) {
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

  const bytes = Object.values(result.metafile.outputs).reduce(
    (sum, output) => sum + output.bytes,
    0,
  )
  console.log(`built ${relative(root, outfile)} (${(bytes / 1024).toFixed(1)} KiB)`)
}

for (const { outfile } of entries) {
  await import(pathToFileURL(outfile).href)
}
console.log('host entries import cleanly')
