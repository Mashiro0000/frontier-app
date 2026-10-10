// Run by verify-fsguard.mjs through tools/guarded-window.mjs (with APPDATA pointing at a FAKE Roaming folder that the test made): shows what a window run can and cannot remove.
// It writes anywhere (allowed in a window run), removes what it made in its own temp folder, in a throwaway profile folder and in the repo's `out` folder (allowed), and tries to
// remove a decoy file next to it, a file in a folder called like the real profile, and the fake Roaming folder itself (refused). It prints one line, RESULT {...}.
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const J = win32.join
const code = (f) => {
  try {
    f()
    return 'DONE'
  } catch (error) {
    return error.code ?? String(error.message)
  }
}
const id = crypto.randomBytes(4).toString('hex')
const roam = process.env.APPDATA
const decoy = process.env.GUARDED_DECOY
const repo = win32.dirname(win32.dirname(fileURLToPath(import.meta.url)))
// Everything this tries to remove is a FIXTURE that the test made a moment ago in its own fresh folder: if a broken guard let a removal through, only that fixture would go. It tries
// NOTHING unless the Roaming folder and the decoy it was given carry the test's marks (so a hand run with the real %APPDATA% does nothing).
const text = (file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
if (text(J(roam ?? '', 'FIXTURE-ONLY.txt')) !== 'FSGUARD-FIXTURE' || text(decoy ?? '') !== 'DECOY') {
  console.error('guarded-window-selftest.mjs: the Roaming folder and the decoy it was given are not the guard test\'s fixtures; nothing is tried.')
  process.exit(3)
}
const r = {}
r.tmp = os.tmpdir()
r.writeBeside = code(() => fs.writeFileSync(`${decoy}.beside`, 'x'))
r.removeBeside = code(() => fs.rmSync(`${decoy}.beside`))
const own = fs.mkdtempSync(J(os.tmpdir(), 'win-selftest-'))
r.ownRun = code(() => { fs.writeFileSync(J(own, 'a.txt'), 'x'); fs.rmSync(own, { recursive: true }) })
const profile = J(roam, `frontier-app-test-scratch-w${id}`)
r.profile = code(() => { fs.mkdirSync(J(profile, 'deep'), { recursive: true }); fs.writeFileSync(J(profile, 'deep', 'f.txt'), 'x'); fs.rmSync(profile, { recursive: true, force: true }) })
r.profileGone = !fs.existsSync(profile)
const outFolder = J(repo, 'out')
r.outFile = fs.existsSync(outFolder) ? code(() => { const f = J(outFolder, `selftest-${id}.txt`); fs.writeFileSync(f, 'x'); fs.rmSync(f) }) : 'NO-OUT'
r.removeDecoy = code(() => fs.rmSync(decoy))
r.removeRealProfile = code(() => fs.rmSync(J(roam, 'frontier-app', 'keep.txt')))
r.removeRoaming = code(() => fs.rmSync(roam, { recursive: true }))
r.removeOtherInRoaming = code(() => fs.rmSync(J(roam, 'other-app', 'keep.txt')))
console.log(`RESULT ${JSON.stringify(r)}`)
process.exit(0)
