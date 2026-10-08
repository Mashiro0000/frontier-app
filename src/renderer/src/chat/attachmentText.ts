import {
  ATTACHMENT_LIMITS,
  type AttachedFile,
  type AttachmentInfo
} from '../../../shared/attachments'
import type { ModelOption } from '../../../shared/ipc'

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

/** Every file the conversation would send with the next message: those of its earlier messages (sent again each time, D-028) and those on the new one. */
export function chatFiles(
  messages: readonly { files?: AttachedFile[] }[],
  draft: readonly AttachedFile[]
): AttachedFile[] {
  const seen = new Map<string, AttachedFile>()
  for (const file of [...messages.flatMap((message) => message.files ?? []), ...draft]) {
    if (!seen.has(file.info.id)) seen.set(file.info.id, file)
  }
  return [...seen.values()]
}

/**
 * Why the next message cannot be sent as it is (D-037), or null: the model chosen cannot read a kind of file the chat holds (they would all be sent
 * again), or the chat would hold more files than one may. The main process checks the same again.
 */
export function filesBlock(
  messages: readonly { files?: AttachedFile[] }[],
  draft: readonly AttachedFile[],
  model: Pick<ModelOption, 'label' | 'imageInput' | 'documentInput'> | null,
  /** The files of the chat's project (D-039, 10.6): sent with every message too, and counted with the chat's own. */
  projectFiles: readonly AttachmentInfo[] = []
): string | null {
  const own = chatFiles(messages, draft)
  if (own.length > ATTACHMENT_LIMITS.perChat) {
    return `A chat can hold at most ${ATTACHMENT_LIMITS.perChat} files. Start a new chat for more.`
  }
  const infos = [
    ...projectFiles,
    ...own.map((file) => file.info).filter((info) => !projectFiles.some((p) => p.id === info.id))
  ]
  const all = infos.map((info) => ({ info }))
  // What one request may carry (the main process checks the same again): a project's files count with the chat's, and say so.
  const L = ATTACHMENT_LIMITS
  const theirs =
    projectFiles.length > 0
      ? " The project's files count too: they go with every message of its chats."
      : ''
  const bytes = infos.reduce((sum, info) => sum + info.bytes, 0)
  const pages = infos.reduce((sum, info) => sum + (info.pages ?? 0), 0)
  const chars = infos.reduce((sum, info) => sum + (info.chars ?? 0), 0)
  if (bytes > L.maxRequestBytes) {
    return `The files of this chat come to more than one request may carry (${Math.round(L.maxRequestBytes / (1024 * 1024))} MB).${theirs}`
  }
  if (pages > L.maxRequestPages) {
    return `The PDFs of this chat have more pages than one request may carry (${L.maxRequestPages}).${theirs}`
  }
  if (chars > L.maxRequestTextChars) {
    return `The text files of this chat have more characters than one request may carry (${L.maxRequestTextChars.toLocaleString('en-US')}).${theirs}`
  }
  if (model === null) return null
  if (!model.imageInput && all.some((file) => file.info.kind === 'image')) {
    return `${model.label} cannot read images, and this chat has one. Choose a model that can.`
  }
  if (!model.documentInput && all.some((file) => file.info.kind === 'pdf')) {
    return `${model.label} cannot read PDFs, and this chat has one. Choose a model that can.`
  }
  return null
}
