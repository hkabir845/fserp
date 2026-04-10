/**
 * Remove .next completely so Next can regenerate middleware-manifest.json and chunks.
 * On Windows, .next/trace is often locked if "next dev" is still running — stop dev first.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const nextDir = path.join(root, '.next')

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function tryRemoveTraceFile() {
  const trace = path.join(nextDir, 'trace')
  for (let i = 0; i < 6; i++) {
    try {
      if (fs.existsSync(trace)) fs.unlinkSync(trace)
      return
    } catch {
      /* locked */
    }
  }
}

async function main() {
  if (!fs.existsSync(nextDir)) {
    console.log('.next not found — nothing to clean.')
    return
  }

  tryRemoveTraceFile()

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(nextDir, { recursive: true, force: true })
      console.log('Removed .next — run npm run dev to rebuild.')
      return
    } catch (e) {
      if (attempt === 9) {
        console.error('Could not remove .next:', e.message)
        console.error('')
        console.error('Usually a file is locked (often .next/trace):')
        console.error('  1. Stop ALL "npm run dev" / Next.js terminals (Ctrl+C).')
        console.error('  2. In Task Manager, end extra "Node.js" processes for this project if any remain.')
        console.error('  3. Run: npm run clean:next')
        console.error('  4. Then: npm run dev')
        process.exit(1)
      }
      await sleep(350)
    }
  }
}

await main()
