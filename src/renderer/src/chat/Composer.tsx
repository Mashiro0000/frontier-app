import { useEffect, useRef, useState } from 'react'
import { IconEnhance, IconSend, IconStop } from '../icons'
import type { EnhanceResult } from './enhance'
import MicButton from '../voice/MicButton'
import { useListen } from '../voice/useListen'
import { useVoiceStatus } from '../voice/voiceStatus'

interface ComposerProps {
  /** When this changes (a new conversation, or another one), the input box asks for the keyboard focus. */
  focusKey?: string
  isReplying: boolean
  onSend: (text: string) => void
  onStop: () => void
  /** The chips of the files on this message (D-037), drawn at the top of the box. */
  attachments?: React.ReactNode
  /** The chat's own buttons (D-051): drawn in the box, in the row under the text, beside Send. */
  toolbar?: React.ReactNode
  /** Files are on the message (D-037): it can be sent with no text. */
  hasFiles?: boolean
  /** Why the message cannot be sent as it is (a model that cannot read a kind of file, too many files in the chat), or null. */
  blocked?: string | null
  /** Files pasted into the box (an image copied to the clipboard): they are attached, not typed. */
  onPasteFiles?: (files: File[]) => void
  /** The button that ends a reply says "Stop everything" when a tool is switched on (D-041, 11.4): it also stops a tool that is running and closes a question. */
  stopEverything?: boolean
  /**
   * (21.4, D-053) Enhance: rewrites the draft (the cheapest model with a key) and gives back the text for the box, which the person reads, changes or undoes.
   * Never sends anything to the chat. Absent: no Enhance button.
   */
  onEnhance?: (text: string, signal: AbortSignal) => Promise<EnhanceResult>
  /** (21.4) Examples the empty box shows, one after another (an empty chat): "Try: ...". Absent: "Type a message". */
  examples?: readonly string[]
  /** (21.4) What to call a model, for the line that says which one enhanced the draft. */
  modelName?: (modelId: string) => string
}

function Composer({
  focusKey,
  isReplying,
  onSend,
  onStop,
  attachments,
  toolbar,
  hasFiles = false,
  blocked = null,
  onPasteFiles,
  stopEverything = false,
  onEnhance,
  examples,
  modelName = (id) => id
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  // (21.4) The example shown in the empty box: the next one every four seconds, while there are examples.
  const [example, setExample] = useState(0)
  useEffect(() => {
    if (examples === undefined || examples.length < 2) return
    const timer = setInterval(() => setExample((n) => (n + 1) % examples.length), 4000)
    return () => clearInterval(timer)
  }, [examples])
  // (21.4) Enhance: the rewrite in flight (to stop it), the draft before it (for Undo), and the line under the box.
  const enhancing = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [before, setBefore] = useState<string | null>(null)
  const [enhanceNote, setEnhanceNote] = useState<string | null>(null)
  useEffect(() => () => enhancing.current?.abort(), [])

  async function runEnhance(): Promise<void> {
    if (onEnhance === undefined || busy || isReplying || text.trim() === '') return
    const controller = new AbortController()
    enhancing.current = controller
    setBusy(true)
    setEnhanceNote(null)
    const draft = text
    const result = await onEnhance(draft, controller.signal)
    enhancing.current = null
    setBusy(false)
    if (controller.signal.aborted) return
    if (result.ok) {
      setBefore(draft)
      setText(result.text)
      setEnhanceNote(`Rewritten by ${modelName(result.model)}. Read it before you send it.`)
    } else {
      setEnhanceNote(result.error)
    }
    inputRef.current?.focus()
  }
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // "Speak to type" (D-047): the words come back as text in the box, to be read and sent by the person; they are never sent from here.
  const voice = useVoiceStatus()
  const listen = useListen((words) => {
    setText((now) => (now === '' ? words : `${now}${/\s$/.test(now) ? '' : ' '}${words}`))
    inputRef.current?.focus()
  })

  // Starting a new chat leaves the cursor in the input box. (Opening a saved chat from the History dialog does
  // not get here: a dialog that closes gives the focus back to the button that opened it.)
  useEffect(() => {
    inputRef.current?.focus()
  }, [focusKey])
  // You can type the next message while a reply streams in, but not send it until the reply ends.
  const canSend = (text.trim() !== '' || hasFiles) && !isReplying && blocked === null

  function submit(): void {
    if (!canSend) return
    onSend(text.trim())
    setText('')
    setBefore(null)
    setEnhanceNote(null)
    inputRef.current?.focus() // keep typing without clicking back into the box
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="composer-inner">
        {attachments}
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          value={text}
          placeholder={
            examples !== undefined && examples.length > 0
              ? `Try: ${examples[example % examples.length]}`
              : 'Type a message'
          }
          aria-label="Message"
          autoFocus
          onChange={(event) => {
            setText(event.target.value)
            if (before !== null) setBefore(null) // a change of the person's own: Undo would throw it away
            if (enhanceNote !== null && !busy) setEnhanceNote(null)
          }}
          onPaste={(event) => {
            // A pasted image (or file) is attached, not typed. When the clipboard also holds text (copied cells, a page), the text is pasted as
            // usual and nothing is attached, so a copy that happens to carry a picture never sends one by surprise.
            const files = [...event.clipboardData.files]
            if (
              files.length > 0 &&
              event.clipboardData.getData('text/plain') === '' &&
              onPasteFiles
            ) {
              event.preventDefault()
              onPasteFiles(files)
            }
          }}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter adds a new line. Enter that only confirms an
            // input-method candidate (for example Japanese or Chinese typing) must not send.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="composer-row">
          {toolbar}
          <div className="composer-end">
            {onEnhance !== undefined && (
              <button
                type="button"
                className={`composer-enhance${busy ? ' composer-enhance-busy' : ''}`}
                disabled={isReplying || (!busy && text.trim() === '')}
                aria-label={busy ? 'Stop enhancing' : 'Enhance'}
                title={
                  busy
                    ? 'Rewriting your message... Click to stop.'
                    : 'Enhance: rewrite your message to be clearer and more specific, with the cheapest model you have a key for. You read it before anything is sent.'
                }
                onClick={() => {
                  if (busy) {
                    enhancing.current?.abort()
                    enhancing.current = null
                    setBusy(false)
                    setEnhanceNote(null)
                  } else void runEnhance()
                }}
              >
                <IconEnhance />
              </button>
            )}
            {voice?.listen === true && <MicButton listen={listen} />}
            {/* Two separate buttons (note the keys) rather than one that changes type: otherwise a
                click on Stop could turn into a form submit and send the half-typed next message. */}
            {isReplying ? (
              <button
                key="stop"
                type="button"
                className="composer-button composer-button-stop"
                title={
                  stopEverything
                    ? 'Ends the reply, stops a tool that is running and closes a question that is waiting.'
                    : undefined
                }
                onClick={() => {
                  onStop()
                  inputRef.current?.focus()
                }}
              >
                <IconStop />
                {stopEverything ? 'Stop everything' : 'Stop'}
              </button>
            ) : (
              <button
                key="send"
                type="submit"
                className="composer-button"
                disabled={!canSend}
                title={blocked ?? undefined}
              >
                <IconSend />
                <span className="visually-hidden">Send</span>
              </button>
            )}
          </div>
        </div>
      </div>
      {/* How a hold of the microphone is going (D-047). The window's title and the taskbar button say the same, and are main's; this is the page's own line. */}
      {listen.phase !== 'idle' && (
        <p className="composer-voice" role="status">
          {listen.phase === 'sending'
            ? 'Writing it down...'
            : listen.phase === 'starting'
              ? 'Opening the microphone...'
              : `Recording ${listen.seconds} s. Let go to send it to OpenAI; Esc cancels.`}
        </p>
      )}
      {listen.phase === 'idle' && listen.notice !== null && (
        <p className="composer-voice composer-voice-notice" role="status">
          {listen.notice}
        </p>
      )}
      {/* (21.4) What Enhance did, and Undo. */}
      {enhanceNote !== null && (
        <p className="composer-voice composer-enhance-note" role="status">
          {enhanceNote}
          {before !== null && (
            <>
              {' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setText(before)
                  setBefore(null)
                  setEnhanceNote(null)
                  inputRef.current?.focus()
                }}
              >
                Undo
              </button>
            </>
          )}
        </p>
      )}
      {/* Why Send is off while files are in the way (D-037), said on screen and not only in the button's tooltip. */}
      {blocked !== null && (
        <p className="composer-blocked" role="status">
          {blocked}
        </p>
      )}
    </form>
  )
}

export default Composer
