// Makes the small binary fixtures of the Stage 9 suites with Electron's own encoders (a JPEG, PNGs, WebPs from Chromium's canvas, PDFs from
// Chromium's print), so that the plain-Node suites have real files of the kinds no Node package-free code can make. Test tooling only.
// usage (it is an Electron main script, not a Node one):
//   node_modules\electron\dist\electron.exe tools\make-fixtures-9.cjs --user-data-dir=<a scratch folder>
// Writes tools/fixtures9/*. Run again only to remake them; the suites read the committed copies.
const { app, BrowserWindow, nativeImage } = require('electron')
const { mkdirSync, writeFileSync } = require('fs')
const { join } = require('path')

const OUT = join(__dirname, 'fixtures9')
mkdirSync(OUT, { recursive: true })

/** A picture of four solid quadrants (red, green, blue, white from the top left, clockwise: TL red, TR green, BR white, BL blue), BGRA. */
function quadrants(width, height) {
  const bitmap = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const right = x >= width / 2
      const bottom = y >= height / 2
      const [r, g, b] = !bottom ? (right ? [0, 255, 0] : [255, 0, 0]) : right ? [255, 255, 255] : [0, 0, 255]
      const i = (y * width + x) * 4
      bitmap[i] = b
      bitmap[i + 1] = g
      bitmap[i + 2] = r
      bitmap[i + 3] = 255
    }
  return bitmap
}

app.whenReady().then(async () => {
  const done = []
  const put = (name, bytes) => {
    writeFileSync(join(OUT, name), bytes)
    done.push(`${name} ${bytes.length}`)
  }
  try {
    const q = nativeImage.createFromBitmap(quadrants(64, 32), { width: 64, height: 32 })
    put('q.jpg', q.toJPEG(95))
    put('q.png', q.toPNG())
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await win.loadURL('data:text/html,<canvas id=c width=48 height=24></canvas>')
    const draw = (alpha, type, quality) =>
      win.webContents.executeJavaScript(`(() => {
        const c = document.getElementById('c'); const x = c.getContext('2d'); x.clearRect(0, 0, 48, 24)
        x.fillStyle = 'rgba(255,0,0,${alpha})'; x.fillRect(0, 0, 24, 12); x.fillStyle = 'rgba(0,255,0,${alpha})'; x.fillRect(24, 0, 24, 12)
        x.fillStyle = 'rgba(0,0,255,${alpha})'; x.fillRect(0, 12, 24, 12); x.fillStyle = 'rgba(255,255,255,${alpha})'; x.fillRect(24, 12, 24, 12)
        return c.toDataURL('${type}', ${quality}) })()`)
    const bytesOf = (url) => Buffer.from(url.split(',')[1], 'base64')
    put('lossy.webp', bytesOf(await draw(1, 'image/webp', 0.9)))
    put('lossless.webp', bytesOf(await draw(1, 'image/webp', 1)))
    put('alpha.webp', bytesOf(await draw(0.5, 'image/webp', 0.9)))
    put('alpha.png', bytesOf(await draw(0.5, 'image/png', 1)))
    const pages = (n) =>
      'data:text/html,' +
      encodeURIComponent(
        `<style>p{page-break-after:always}</style>${Array.from({ length: n }, (_, i) => `<p>Page ${i + 1} of a test document.</p>`).join('')}`
      )
    await win.loadURL(pages(3))
    put('three-pages.pdf', await win.webContents.printToPDF({}))
    await win.loadURL(pages(101))
    put('101-pages.pdf', await win.webContents.printToPDF({}))
    win.destroy()
  } catch (error) {
    done.push('ERROR ' + String(error && error.stack))
  }
  console.log(done.join('\n'))
  app.exit(0)
})
