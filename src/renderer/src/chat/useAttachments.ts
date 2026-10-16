import { useCallback, useEffect, useRef, useState } from 'react'
import { ATTACHMENT_LIMITS, type AttachedFile } from '../../../shared/attachments'

// The files on the message being written (Stage 9.2, D-037). Each one is already a checked copy in the main process (the page never holds a path or
// decides what a file is): "Attach..." asks main to open the system's dialog; a paste or a drop hands main the file's bytes and name. Taking a file
// off tells main it is no longer wanted.

export interface UseAttachments {
  /** The files on the message, in the order they came. */
  files: AttachedFile[]
  /** One sentence for each file that was not attached (it names the file and says why). Empty when there is nothing to say. */
  notices: string[]
  /** True while main is working on files (the dialog is open, or a file is being checked and copied). */
  busy: boolean
  /** Opens the system's dialog (in main). */
  pick: () => void
  /** Files pasted or dropped: each is read here and handed to main as bytes. */
  addFiles: (files: File[]) => void
  /** Takes a file off the message. */
  remove: (id: string) => void
  /** The message went: the next one starts with no files (they are kept by main for the chat). */
  clear: () => void
  /** (16.5, D-048) A picture from the gallery ("Use in chat"): main has made it an attachment like a pasted file; it goes on the message like one. */
  adopt: (file: AttachedFile) => void
  /** (16.5) Says one sentence under the message box (a picture that could not be attached). */
  say: (notice: string) => void
}

const MB = 1024 * 1024
const MAX_INPUT = ATTACHMENT_LIMITS.maxImageInputBytes
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

export function useAttachments(): UseAttachments {
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [notices, setNotices] = useState<string[]>([])
  const [working, setWorking] = useState(0)
  // What is on the message right now, for work that runs over several awaits (two drops at once must not pass the cap together).
  const current = useRef<AttachedFile[]>([])
  const keep = useCallback((next: AttachedFile[]): void => {
    current.current = next
    setFiles(next)
  }, [])

  // Only the chat takes a drop (ChatView accepts it there). A file that still reaches the window is never opened by it (the navigation lock would stop
  // that too). The window does not accept drops itself, so the pointer shows where a drop does nothing.
  useEffect(() => {
    const ignore = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    window.addEventListener('drop', ignore)
    return () => window.removeEventListener('drop', ignore)
  }, [])

  /** Puts files main has kept on the message, up to the cap; any it cannot take are let go of again (main is told), with a sentence. */
  const take = useCallback(
    (kept: AttachedFile[], said: string[]): void => {
      const next = [...current.current]
      let over = 0
      for (const file of kept) {
        if (next.some((there) => there.info.id === file.info.id)) {
          said.push(`${file.info.name} is on this message already.`)
          continue
        }
        if (next.length >= ATTACHMENT_LIMITS.perMessage) {
          over += 1
          window.api.attachments.discard(file.info.id)
          continue
        }
        next.push(file)
      }
      if (over > 0) {
        said.push(
          `A message can carry at most ${ATTACHMENT_LIMITS.perMessage} files: ${over} ${plural(over, 'was', 'were')} left out.`
        )
      }
      keep(next)
    },
    [keep]
  )

  const pick = useCallback((): void => {
    if (!window.api) return
    setNotices([])
    setWorking((n) => n + 1)
    window.api.attachments
      .pick()
      .then((result) => {
        if (!result.ok) {
          if (!result.cancelled) setNotices([result.error])
          return
        }
        const said = [...result.refused]
        take(result.files, said)
        setNotices(said)
      })
      .catch(() => setNotices(['The files could not be attached.']))
      .finally(() => setWorking((n) => n - 1))
  }, [take])

  const addFiles = useCallback(
    (dropped: File[]): void => {
      if (!window.api || dropped.length === 0) return
      setNotices([])
      setWorking((n) => n + 1)
      void (async () => {
        const said: string[] = []
        const kept: AttachedFile[] = []
        // Only as many as there is room for are read at all; the rest are named in one sentence.
        const room = Math.max(0, ATTACHMENT_LIMITS.perMessage - current.current.length)
        for (const file of dropped.slice(0, room)) {
          if (file.size > MAX_INPUT) {
            said.push(
              `${file.name || 'The file'} was not attached: it is larger than ${MAX_INPUT / MB} MB.`
            )
            continue
          }
          try {
            const bytes = new Uint8Array(await file.arrayBuffer())
            const result = await window.api.attachments.addBytes(file.name, bytes)
            if (result.ok) kept.push(result.file)
            else said.push(result.error)
          } catch {
            said.push(`${file.name || 'The file'} could not be read.`)
          }
        }
        if (dropped.length > room) {
          said.push(
            `A message can carry at most ${ATTACHMENT_LIMITS.perMessage} files: ${dropped.length - room} ${plural(dropped.length - room, 'was', 'were')} left out.`
          )
        }
        take(kept, said)
        setNotices(said)
        setWorking((n) => n - 1)
      })()
    },
    [take]
  )

  const remove = useCallback(
    (id: string): void => {
      keep(current.current.filter((file) => file.info.id !== id))
      setNotices([])
      window.api?.attachments.discard(id)
    },
    [keep]
  )

  const clear = useCallback((): void => {
    keep([])
    setNotices([])
  }, [keep])

  const adopt = useCallback(
    (file: AttachedFile): void => {
      const said: string[] = []
      take([file], said)
      setNotices(said)
    },
    [take]
  )

  const say = useCallback((notice: string): void => setNotices([notice]), [])

  return { files, notices, busy: working > 0, pick, addFiles, remove, clear, adopt, say }
}
