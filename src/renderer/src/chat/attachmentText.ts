import type { AttachmentInfo } from '../../../shared/attachments'

// How an attachment is described on its chip (D-037): its type, size and the notes about what was done to it. Plain functions, so the wording can be
// checked without a window.

const TYPE_NAMES: Record<AttachmentInfo['mediaType'], string> = {
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
  'image/gif': 'GIF image',
  'image/webp': 'WebP image',
  'application/pdf': 'PDF',
  'text/plain': 'Text'
}

const count = (n: number): string => n.toLocaleString('en-US')

/** A size for people: bytes, KB or MB. */
export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** What a file is, in a few words: its type, its size in pixels, pages or lines, and its weight. */
export function factsOf(info: AttachmentInfo): string {
  const parts = [TYPE_NAMES[info.mediaType]]
  if (info.kind === 'image' && info.width !== undefined && info.height !== undefined) {
    parts.push(`${count(info.width)} x ${count(info.height)}`)
  }
  if (info.kind === 'pdf' && info.pages !== undefined) {
    parts.push(`${count(info.pages)} ${info.pages === 1 ? 'page' : 'pages'}`)
  }
  if (info.kind === 'text' && info.lines !== undefined) {
    parts.push(`${count(info.lines)} ${info.lines === 1 ? 'line' : 'lines'}`)
  }
  parts.push(sizeOf(info.bytes))
  return parts.join(', ')
}

/** What was done to the file on its way in, or what is left in it, as short notes (rule 1: nothing leaves the PC unseen). */
export function notesOf(info: AttachmentInfo): string[] {
  const notes: string[] = []
  const { changes } = info
  if (changes.metadataRemoved) notes.push('metadata removed')
  if (changes.shrunkFrom !== null) {
    notes.push(
      `made smaller from ${count(changes.shrunkFrom.width)} x ${count(changes.shrunkFrom.height)}`
    )
  }
  if (changes.turned) notes.push('turned upright')
  if (changes.convertedFrom !== null) {
    notes.push(`a ${TYPE_NAMES[info.mediaType]} made from a ${TYPE_NAMES[changes.convertedFrom]}`)
  }
  if (info.kind === 'pdf') notes.push('sent as it is, with any metadata it holds')
  return notes
}
