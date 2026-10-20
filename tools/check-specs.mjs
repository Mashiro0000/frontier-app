// Dry check of every committed negative-control spec (tools/specs*/): its sabotage text must still occur EXACTLY once in the file it names.
// nc.mjs refuses to touch anything otherwise ("ABORT ... matches (need exactly 1)"), so a spec whose target line was edited since it was
// written silently stops being a control. Nine had gone stale by the time of Stage 7.4. Changes nothing, opens no window.
// usage: node tools/check-specs.mjs        (exit code 1 if any spec is stale)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUT, REPO, TOOLS } from './paths.mjs'

// the same replacements nc.mjs makes
const fill = (text) => text.replaceAll('{{REPO}}', REPO).replaceAll('{{TOOLS}}', TOOLS.replaceAll('\\', '/')).replaceAll('{{OUT}}', OUT.replaceAll('\\', '/'))
let total = 0
let stale = 0
let retired = 0
for (const entry of readdirSync(TOOLS, { withFileTypes: true }).filter((e) => e.isDirectory() && /^specs/.test(e.name))) {
  for (const name of readdirSync(join(TOOLS, entry.name)).filter((n) => n.endsWith('.json'))) {
    const spec = JSON.parse(fill(readFileSync(join(TOOLS, entry.name, name), 'utf8')))
    // a spec whose code is gone is kept, marked "retired" with the reason, and never run (nc.mjs refuses it): files are not deleted (D-051)
    if (spec.retired) {
      retired++
      continue
    }
    total++
    for (const edit of spec.edits) {
      if (!existsSync(edit.file)) {
        console.log(`MISSING ${entry.name}/${name}: ${edit.file}`)
        stale++
        continue
      }
      const matches = readFileSync(edit.file, 'utf8').split(edit.from).length - 1
      // (an edit may say how many times its text is there, `count`, and which one it sabotages, `nth`: nc.mjs)
      if (matches !== (edit.count ?? 1) || (edit.nth ?? 1) > (edit.count ?? 1)) {
        console.log(`STALE   ${entry.name}/${name}: ${matches} matches in ${edit.file.replace(REPO, '')} for: ${edit.from.slice(0, 80).replaceAll('\n', ' / ')}`)
        stale++
      }
    }
  }
}
console.log(`${total} specs checked, ${stale} stale${retired ? `, ${retired} retired (not checked, never run)` : ''}`)
process.exit(stale === 0 ? 0 : 1)
