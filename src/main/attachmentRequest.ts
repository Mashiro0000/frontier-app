import { ATTACHMENT_LIMITS } from '../shared/attachments'
import type { WireMessage } from '../shared/ipc'
import type { ModelEntry } from '../shared/registry'
import type { ReadResult } from './attachmentStore'
import type { NeutralAttachment, NeutralMessage } from './providers/types'

// The files of a request (Stage 9.3, D-037), turned into what the adapters send. No Electron imports: the store's reader is handed in. The request names
// files by the id of main's own copy (the page cannot point at any other file); each copy is read and checked against its name (its hash) here, every
// time, because the whole conversation is sent again with every message (D-028). Nothing is sent if any file cannot be read, if the model cannot read a
// kind of file the chat holds, or if the files together pass the caps of one request: the person is told why, in one sentence.

/** What the files of one request come to, for the guess of what it costs (9.4). */
export interface RequestFiles {
  /** Every image as it is sent (one entry per time it is sent), by its size in pixels. */
  images: { width: number; height: number }[]
  /** PDFs: how many, and their pages in all. */
  pdfs: number
  pdfPages: number
  /** Text files: their characters in all. */
  textChars: number
  /** Every file's bytes, before base64. */
  bytes: number
}

export const NO_FILES: RequestFiles = { images: [], pdfs: 0, pdfPages: 0, textChars: 0, bytes: 0 }

export type ResolvedRequest =
  { ok: true; messages: NeutralMessage[]; files: RequestFiles } | { ok: false; error: string }

const MB = 1024 * 1024
const mb = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`
const count = (value: number): string => value.toLocaleString('en-US')

/** A PDF's name as a provider is told it: it ends in ".pdf" (a provider may decide what a file is by its name). */
export const pdfName = (name: string): string => (/\.pdf$/i.test(name) ? name : `${name}.pdf`)

const WHY: Record<Exclude<ReadResult, { ok: true }>['why'], string> = {
  missing: "is no longer in the app's data folder",
  damaged: "is damaged in the app's data folder",
  unopened: 'is encrypted, and cannot be opened with the key this computer has'
}

/**
 * The conversation with its files read and checked, in the neutral form the adapters take, or the sentence that says why nothing can be sent. A message
 * with no files comes out as `{ role, content }` and nothing else, so a request without files is exactly what it was before files existed.
 */
export async function resolveAttachments(
  messages: readonly WireMessage[],
  model: ModelEntry,
  read: (id: string) => Promise<ReadResult>
): Promise<ResolvedRequest> {
  const refuse = (error: string): ResolvedRequest => ({
    ok: false,
    error: `Nothing was sent: ${error}`
  })
  const copies = new Map<string, ReadResult>()
  const files: RequestFiles = { images: [], pdfs: 0, pdfPages: 0, textChars: 0, bytes: 0 }
  const out: NeutralMessage[] = []
  for (const message of messages) {
    if (message.attachments === undefined || message.attachments.length === 0) {
      out.push({ role: message.role, content: message.content })
      continue
    }
    const attached: NeutralAttachment[] = []
    for (const { id, name } of message.attachments) {
      let copy = copies.get(id)
      if (copy === undefined) {
        copy = await read(id)
        copies.set(id, copy)
      }
      if (!copy.ok) return refuse(`the file "${name}" in this chat ${WHY[copy.why]}.`)
      const { facts, bytes } = copy
      if (facts.kind === 'image' && !model.capabilities.imageInput) {
        return refuse(
          `${model.label} cannot read images, and this chat has one ("${name}"). Choose a model that can.`
        )
      }
      if (facts.kind === 'pdf' && !model.capabilities.documentInput) {
        return refuse(
          `${model.label} cannot read PDFs, and this chat has one ("${name}"). Choose a model that can.`
        )
      }
      files.bytes += bytes.length
      if (facts.kind === 'image') {
        files.images.push({ width: facts.width, height: facts.height })
        attached.push({ kind: 'image', mediaType: facts.mediaType, data: bytes.toString('base64') })
      } else if (facts.kind === 'pdf') {
        files.pdfs += 1
        files.pdfPages += facts.pages
        attached.push({ kind: 'pdf', name: pdfName(name), data: bytes.toString('base64') })
      } else {
        files.textChars += facts.chars
        attached.push({ kind: 'text', name, text: facts.text })
      }
    }
    out.push({ role: message.role, content: message.content, attachments: attached })
  }
  const L = ATTACHMENT_LIMITS
  const again =
    'every file in a chat is sent again with each message, so start a new chat to send more.'
  if (files.bytes > L.maxRequestBytes) {
    return refuse(
      `the files in this chat come to ${mb(files.bytes)}, and one request may carry at most ${mb(L.maxRequestBytes)}; ${again}`
    )
  }
  if (files.pdfPages > L.maxRequestPages) {
    return refuse(
      `the PDFs in this chat have ${count(files.pdfPages)} pages, and one request may carry at most ${L.maxRequestPages}; ${again}`
    )
  }
  if (files.textChars > L.maxRequestTextChars) {
    return refuse(
      `the text files in this chat have ${count(files.textChars)} characters, and one request may carry at most ${count(L.maxRequestTextChars)}; ${again}`
    )
  }
  return { ok: true, messages: out, files }
}
