/**
 * Cleans generated package output. Only ever touches `<repo>/lib`; the path is
 * derived from this script's location, never from a caller-supplied argument.
 */
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const libDir = join(root, 'lib')

await rm(libDir, { recursive: true, force: true })
console.log(`cleaned ${libDir}`)
