import { useEffect, useRef } from 'react'
import type { RestorePreview } from '../../../shared/ipc'
import { formatWhen } from './format'

interface RestorePreviewPanelProps {
  preview: RestorePreview
  disabled: boolean
  onAdd: () => void
  onDismiss: () => void
}

const chats = (count: number): string => `${count} ${count === 1 ? 'chat' : 'chats'}`

/**
 * What a backup file holds, shown before anything is added (D-034). Everything on it is what main read from the file and checked; the file's
 * own words are shown as plain text. Nothing is added until "Add" is pressed, and nothing already saved is ever replaced.
 */
function RestorePreviewPanel({
  preview,
  disabled,
  onAdd,
  onDismiss
}: RestorePreviewPanelProps): React.JSX.Element {
  const toAdd = preview.fresh + preview.copies
  const fits = Math.min(toAdd, preview.room)
  // The safe choice has the focus: Enter or Space adds nothing. (With nothing to add, it is the only button that does anything.)
  const dismissRef = useRef<HTMLButtonElement>(null)
  useEffect(() => dismissRef.current?.focus(), [])

  return (
    <section className="backup-preview" aria-labelledby="backup-preview-title">
      <h3 id="backup-preview-title" className="backup-preview-heading">
        Restore from <span className="backup-preview-file">{preview.fileName}</span>
      </h3>
      <p className="history-hint">
        {preview.exportedAt === null
          ? 'Made at a time the file does not say.'
          : `Made ${formatWhen(preview.exportedAt)}.`}
      </p>
      {!preview.complete && (
        <p className="history-notice history-notice-error" role="status">
          This file is not whole: it stops short, has chats missing, or has lines after its end.
          Everything that could be read is counted below.
        </p>
      )}
      <ul className="backup-preview-facts" aria-label="What is in the file">
        <li>
          <strong>{chats(preview.fresh)}</strong> new, to be added as{' '}
          {preview.fresh === 1 ? 'it is' : 'they are'}
        </li>
        <li>
          <strong>{chats(preview.same)}</strong> already here, left as{' '}
          {preview.same === 1 ? 'it is' : 'they are'}
        </li>
        <li>
          <strong>{chats(preview.copies)}</strong> {preview.copies === 1 ? 'shares' : 'share'} an id
          with a different chat that is here, to be added as{' '}
          {preview.copies === 1 ? 'a copy' : 'copies'}
        </li>
        {preview.refusedCount > 0 && (
          <li>
            <strong>{chats(preview.refusedCount)}</strong> in the file cannot be used
          </li>
        )}
      </ul>
      {preview.refused.length > 0 && (
        <ul className="backup-preview-why" aria-label="Why some chats cannot be used">
          {preview.refused.map((one) => (
            <li key={one.line}>
              Line {one.line}: {one.why}
            </li>
          ))}
        </ul>
      )}
      {preview.leftOutAtExport !== null && preview.leftOutAtExport > 0 && (
        <p className="history-hint">
          When this backup was made,{' '}
          {preview.leftOutAtExport === 1
            ? '1 saved file'
            : `${preview.leftOutAtExport} saved files`}{' '}
          could not be read and {preview.leftOutAtExport === 1 ? 'was' : 'were'} left out of it.
        </p>
      )}
      {preview.titles.length > 0 && (
        <>
          <p className="history-hint">To be added:</p>
          <ul className="backup-preview-titles" aria-label="Chats to be added">
            {preview.titles.map((title, index) => (
              <li key={index}>{title}</li>
            ))}
            {toAdd > preview.titles.length && (
              <li className="history-hint">and {toAdd - preview.titles.length} more</li>
            )}
          </ul>
        </>
      )}
      {preview.withInstructions > 0 && (
        <p className="history-notice" role="status">
          {preview.withInstructions === 1
            ? '1 of these chats has'
            : `${preview.withInstructions} of these chats have`}{' '}
          instructions of {preview.withInstructions === 1 ? 'its' : 'their'} own, which are sent to
          the model with every message of that chat. Look at them under Instructions after opening
          one.
        </p>
      )}
      {toAdd > 0 && (
        <p className="history-hint">
          Add only a backup you made yourself or trust: when you continue one of these chats, the
          model reads what is in it as a conversation that really happened.
        </p>
      )}
      {toAdd > preview.room && (
        <p className="history-notice history-notice-error" role="status">
          There is room for {preview.room} more saved {preview.room === 1 ? 'chat' : 'chats'}, so
          only {fits === 1 ? 'the first' : `the first ${fits}`} can be added. Delete some chats
          first to add the rest.
        </p>
      )}
      <div className="history-actions">
        <button type="button" className="button" disabled={disabled || fits === 0} onClick={onAdd}>
          {fits === 0 ? 'Nothing to add' : `Add ${chats(fits)}`}
        </button>
        <button
          ref={dismissRef}
          type="button"
          className="button button-secondary"
          disabled={disabled}
          onClick={onDismiss}
        >
          {fits === 0 ? 'Back to the list' : "Don't add"}
        </button>
      </div>
    </section>
  )
}

export default RestorePreviewPanel
