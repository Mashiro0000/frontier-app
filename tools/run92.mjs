// usage: node tools/run92.mjs [mode=dev]
// Slice 9.2 (D-037): getting files in, in the real window (verify-9-2w.mjs). Before the app starts it makes the files the suite will point the (replaced)
// system dialog at, in a folder OUTSIDE the profile: a photo with a place in its EXIF and held sideways, a PNG, a PDF, text files, an animated GIF, a program,
// a file over the cap, a junction, and twelve small texts. The suite proves the dialog, the chips, removing one, the caps, a paste, a drop, what the page
// cannot do through the bridge, and the layout. Needs INSPECT_PORT: the dialog is replaced from the main process's inspector.
// Do not edit src/ while this runs: the launch builds from the tree.
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runApp, scratch } from './drive.mjs'
import { APP, fixture, jpegWith, makeGif } from './lib9.mjs'

const mode = process.argv[2] ?? 'dev'
const P = scratch('s92')
const FILES = scratch('s92-files')
rmSync(P, { recursive: true, force: true })
rmSync(FILES, { recursive: true, force: true })
mkdirSync(join(FILES, 'many'), { recursive: true })
mkdirSync(join(FILES, 'real'), { recursive: true })

writeFileSync(join(FILES, 'holiday.jpg'), jpegWith([APP.exif(6, { secret: 'GPS-HOME-51.5N' }), APP.comment('taken by SECRET-CAMERA-OWNER')]))
writeFileSync(join(FILES, 'diagram.png'), fixture('alpha.png'))
writeFileSync(join(FILES, 'report.pdf'), fixture('three-pages.pdf'))
writeFileSync(join(FILES, 'notes.md'), '# Notes\n\nFirst line of my notes\nSecond line\nThird line\nFourth line\nFifth line\nSixth line, not on the chip\n')
writeFileSync(join(FILES, 'dancing.gif'), makeGif({ frames: 2 }))
writeFileSync(join(FILES, 'setup.exe'), Buffer.from('MZ\x90\x00\x03\x00\x00\x00program bytes', 'latin1'))
writeFileSync(join(FILES, 'huge.bin'), Buffer.alloc(21 * 1024 * 1024, 7))
writeFileSync(join(FILES, 'real', 'inside.png'), fixture('q.png'))
symlinkSync(join(FILES, 'real'), join(FILES, 'link-folder'), 'junction')
for (let i = 1; i <= 12; i++) writeFileSync(join(FILES, 'many', `note-${String(i).padStart(2, '0')}.txt`), `This is small note number ${i}.\n`)
console.log(`made the files in ${FILES}`)

const r = runApp({
  label: (mode === 'preview' ? 'p-' : 'd-') + 'w92',
  mode,
  scripts: 'verify-9-2w.mjs',
  env: { USER_DATA_DIR: P, FILES_DIR: FILES, INSPECT_PORT: '9230', MOCK_PORT: '8796', MOCK_SCRIPT: 'mock-providers.mjs' },
  timeoutMs: 600000
})
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
