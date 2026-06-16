/**
 * One-off: remove Layout import and un-wrap <Layout>...</Layout> from pages
 * after moving shell to AppShell in root layout.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.join(__dirname, '../src/app')

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/page\.tsx$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(appDir)

for (const file of files) {
  let s = fs.readFileSync(file, 'utf8')
  if (!s.includes("@/components/Layout")) continue

  // Remove import line
  s = s.replace(/^import \{ Layout \} from '@\/components\/Layout'\r?\n/, "")
  s = s.replace(/^import \{ Layout \} from "@\/components\/Layout"\r?\n/, "")

  // Unwrap single top-level <Layout>...</Layout> when it's the direct outer wrapper of return (common pattern)
  // Handle: return (\n    <Layout>\n      <div -> return (\n      <div
  let changed = true
  while (changed) {
    changed = false
    const m = s.match(/\n(\s*)<Layout>([\s\S]*?)\n\1<\/Layout>/)
    if (m) {
      const inner = m[2]
      s = s.replace(/\n(\s*)<Layout>([\s\S]*?)\n\1<\/Layout>/, "\n$1" + inner.trimEnd())
      changed = true
    }
  }

  // Also: return <Layout>...</Layout> single line cases (simplified)
  s = s.replace(/return \(\s*<Layout>([\s\S]*?)<\/Layout>\s*\)/g, "return ($1)")

  fs.writeFileSync(file, s)
  console.log(file)
}
