// Whether the bytes of a file are text that the app can show, read to a model and compare line by line (Stage 12.1, D-042): UTF-8, with or without a byte-order
// mark, and no NUL byte. Binary files, UTF-16 and anything that is not valid UTF-8 are refused with a sentence, never guessed at. The line-ending style is
// reported so that a change keeps it (12.4). No Electron imports.

export type LineEnding = 'lf' | 'crlf' | 'mixed' | 'none'

export type DecodedText =
  { ok: true; text: string; bom: boolean; eol: LineEnding } | { ok: false; why: string }

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** The line endings a text uses: only LF, only CRLF, a mix (a lone CR counts as a mix), or none. */
export function lineEndings(text: string): LineEnding {
  let lf = 0
  let crlf = 0
  let cr = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++
        i++
      } else cr++
    } else if (code === 10) lf++
  }
  if (cr > 0 || (lf > 0 && crlf > 0)) return 'mixed'
  if (crlf > 0) return 'crlf'
  return lf > 0 ? 'lf' : 'none'
}

export function decodeText(bytes: Uint8Array): DecodedText {
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  ) {
    return { ok: false, why: 'it is in another encoding (UTF-16), not UTF-8' }
  }
  if (bytes.includes(0)) return { ok: false, why: 'it is a binary file (it holds a NUL byte)' }
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let text: string
  try {
    text = UTF8.decode(bom ? bytes.subarray(3) : bytes)
  } catch {
    return { ok: false, why: 'it is not valid UTF-8 text' }
  }
  return { ok: true, text, bom, eol: lineEndings(text) }
}
