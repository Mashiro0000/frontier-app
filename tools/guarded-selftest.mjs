// Run by verify-fsguard.mjs through tools/guarded.mjs: shows what a check run that way can and cannot do. It makes and removes its own things inside the run's folder (allowed),
// and tries to remove and to write beside a decoy file outside it (refused). It prints one line, RESULT {...}, for the test to read. Nothing here touches anything but the decoy
// named in GUARDED_DECOY, which the test made for it, and only to be refused.
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'

const r = {}
const code = (f) => {
  try {
    f()
    return 'DONE'
  } catch (error) {
    return error.code ?? String(error.message)
  }
}
const own = fs.mkdtempSync(win32.join(os.tmpdir(), 'selftest-'))
r.ownWrite = code(() => fs.writeFileSync(win32.join(own, 'a.txt'), 'x'))
r.ownRename = code(() => fs.renameSync(win32.join(own, 'a.txt'), win32.join(own, 'b.txt')))
r.ownRemove = code(() => fs.rmSync(own, { recursive: true }))
r.ownGone = !fs.existsSync(own)
const decoy = process.env.GUARDED_DECOY
r.removeDecoy = code(() => fs.rmSync(decoy))
r.writeBeside = code(() => fs.writeFileSync(`${decoy}.new`, 'x'))
r.mkdirBeside = code(() => fs.mkdirSync(`${decoy}.dir`))
r.mkdirThere = code(() => fs.mkdirSync(win32.dirname(decoy), { recursive: true }))
r.tmp = os.tmpdir()
r.keepTemp = process.env.FRONTIER_KEEP_TEMP
console.log(`RESULT ${JSON.stringify(r)}`)
process.exit(Number(process.env.GUARDED_EXIT ?? 0))
