/**
 * If .next exists but middleware-manifest.json is missing (common on Windows after a
 * partial delete or failed compile), Next throws MODULE_NOT_FOUND on every request.
 * Write the same empty manifest webpack would emit so dev can start; Next overwrites
 * on successful compile.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = path.join(root, '.next', 'server')
const manifestPath = path.join(serverDir, 'middleware-manifest.json')

const EMPTY_MANIFEST = {
  version: 3,
  middleware: {},
  functions: {},
  sortedMiddleware: [],
}

if (!fs.existsSync(manifestPath)) {
  fs.mkdirSync(serverDir, { recursive: true })
  fs.writeFileSync(manifestPath, JSON.stringify(EMPTY_MANIFEST, null, 2), 'utf8')
  console.log('[next] Created stub .next/server/middleware-manifest.json (run a full compile if issues persist).')
}
