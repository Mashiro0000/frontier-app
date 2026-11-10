import type { ChatStorageStatus } from '../../../shared/ipc'
import { useChatStorage } from './useChatStorage'

interface ChatStorageSectionProps {
  /** Whether Settings is open: the section looks at the chats again each time it opens. */
  open: boolean
  /** Called after encryption was turned on or off, so the History list can look again. */
  onChanged: () => void
}

const chats = (count: number): string => `${count} ${count === 1 ? 'chat' : 'chats'}`
const files = (count: number): string => `${count} saved ${count === 1 ? 'file' : 'files'}`

/** Which of the buttons belong to the state the chats are in, and what they say. */
function actionsFor(status: ChatStorageStatus): { encrypt: string | null; plain: string | null } {
  if (status.choice === 'off') {
    return {
      encrypt: 'Encrypt my saved chats...',
      plain: status.encrypted > 0 ? 'Turn the encrypted chats back to plain files...' : null
    }
  }
  if (status.choice === 'unreadable') {
    return { encrypt: 'Encrypt my saved chats...', plain: 'Use plain files...' }
  }
  // On: the key is usable, or it is not and nothing can be encrypted until it is.
  if (status.keyUsable !== true) return { encrypt: null, plain: 'Turn encryption off...' }
  return {
    encrypt: status.plain > 0 ? 'Encrypt the rest...' : null,
    plain: 'Go back to plain files...'
  }
}

/** One line on how the chats are kept now. */
function stateLine(status: ChatStorageStatus): string {
  if (status.choice === 'off') return 'Chats are saved as plain files.'
  if (status.choice === 'unreadable') return 'It is not known whether chats are encrypted.'
  return status.keyUsable === true
    ? `Encryption is on: ${chats(status.encrypted)} ${status.encrypted === 1 ? 'is' : 'are'} encrypted, and every chat you save from now on is too.`
    : 'Encryption is on, but its key cannot be used now.'
}

/**
 * "Saved chats" in Settings (D-035): whether the chats on disk are encrypted with this computer's secure storage, and how to turn that on or off. Turning it on
 * asks where to put a backup first; turning it off is asked in the system's own message box. The section only shows what the main process says and starts
 * the two actions: it never sees a key, a check or a path.
 */
function ChatStorageSection({ open, onChanged }: ChatStorageSectionProps): React.JSX.Element {
  const storage = useChatStorage(open, onChanged)
  const { status } = storage
  const actions = status === null ? null : actionsFor(status)

  return (
    <section
      className="settings-section storage-section"
      aria-labelledby="settings-storage-heading"
    >
      <h3 id="settings-storage-heading" className="settings-heading">
        Saved chats
      </h3>
      <p className="settings-hint settings-lead">
        Chats are saved on this computer. Encrypting them stops a copy being read on another
        computer or account.
      </p>
      <p className="settings-hint settings-more">
        Your chats are saved as files in the app&apos;s data folder on this computer. You can have
        the app encrypt them with this computer&apos;s secure storage, the protection your API keys
        already have: a copy of the files taken to another computer or account cannot be read. It
        does not stop a program running as you, and it does not cover a backup, which is always a
        plain file.
      </p>
      {status === null ? (
        <p className="settings-status">
          {storage.loadError ? `Could not look: ${storage.loadError}.` : 'Checking...'}
        </p>
      ) : (
        <>
          <p className="settings-status">{stateLine(status)}</p>
          {status.blocked !== null && (
            <p className="settings-notice settings-notice-error" role="alert">
              {status.blocked}
            </p>
          )}
          {status.choice === 'on' && status.keyUsable === false && (
            <p className="settings-hint">
              No file was changed. If you made a backup when you turned encryption on, Restore from
              a backup in History brings the chats back as copies. Turning encryption off lets chats
              be saved again as plain files and leaves the encrypted ones exactly as they are.
            </p>
          )}
          {status.choice === 'on' && status.keyUsable === true && (
            <p className="settings-hint">
              A backup holds the chats as they were when you made it. Back up now and then (History,
              Back up all chats...): a chat saved after your last backup cannot be brought back if
              the key is lost.
            </p>
          )}
          {status.choice === 'on' && status.keyUsable === true && status.plain > 0 && (
            <p className="settings-hint">
              {chats(status.plain)} {status.plain === 1 ? 'is' : 'are'} not encrypted yet (a change
              was cut short, or a file could not be rewritten).
            </p>
          )}
          {status.choice === 'off' && status.encrypted > 0 && (
            <p className="settings-hint">
              {chats(status.encrypted)} {status.encrypted === 1 ? 'is' : 'are'} still encrypted from
              before.
            </p>
          )}
          {status.unopened > 0 && (
            <p className="settings-hint">
              {files(status.unopened)} {status.unopened === 1 ? 'is' : 'are'} encrypted and could
              not be opened with this computer&apos;s key.{' '}
              {status.unopened === 1 ? 'It is' : 'They are'} left exactly as{' '}
              {status.unopened === 1 ? 'it is' : 'they are'}.
            </p>
          )}
          {actions !== null && (actions.encrypt !== null || actions.plain !== null) && (
            <div className="settings-actions">
              {actions.encrypt !== null && (
                <button
                  type="button"
                  className="button storage-button"
                  disabled={storage.working || !status.canEncrypt}
                  onClick={() => void storage.encrypt()}
                >
                  {actions.encrypt}
                </button>
              )}
              {actions.plain !== null && (
                <button
                  type="button"
                  className="button button-secondary storage-button"
                  disabled={storage.working}
                  onClick={() => void storage.decrypt()}
                >
                  {actions.plain}
                </button>
              )}
            </div>
          )}
          {actions?.encrypt !== null && !status.canEncrypt && (
            <p className="settings-hint">
              This computer has no secure storage to keep the key in, so chats cannot be encrypted
              here.
            </p>
          )}
          {actions?.encrypt !== null && status.canEncrypt && (
            <p className="settings-hint">
              Turning it on first asks where to save a backup of your chats. The app checks the
              backup, and only then encrypts. If this computer&apos;s key is ever lost (a reset
              profile, another Windows account), encrypted chats cannot be opened, and that backup
              is how you get them back.
            </p>
          )}
        </>
      )}
      {storage.notice && (
        <p
          className={
            storage.notice.kind === 'error'
              ? 'settings-notice settings-notice-error'
              : 'settings-notice'
          }
          role={storage.notice.kind === 'error' ? 'alert' : 'status'}
        >
          {storage.notice.text}
        </p>
      )}
    </section>
  )
}

export default ChatStorageSection
