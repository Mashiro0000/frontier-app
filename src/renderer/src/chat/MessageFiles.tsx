import { useContext } from 'react'
import type { AttachedFile } from '../../../shared/attachments'
import { factsOf } from './attachmentText'
import { PreviewsContext } from './previews'

/** The files on a message of the person's, above its text: a small picture or the type, the name and what it is. Read only. */
function MessageFiles({ files }: { files: AttachedFile[] }): React.JSX.Element {
  const previews = useContext(PreviewsContext)
  return (
    <ul className="message-files" aria-label="Files on this message">
      {files.map(({ info, thumbnail, firstLines }) => {
        const preview = previews.get(info.id)
        const missing = preview !== undefined && 'missing' in preview ? preview.missing : null
        const picture =
          thumbnail ?? (preview !== undefined && 'thumbnail' in preview ? preview.thumbnail : null)
        const lines =
          firstLines ??
          (preview !== undefined && 'firstLines' in preview ? preview.firstLines : null)
        return (
          <li
            key={info.id}
            className={missing === null ? 'message-file' : 'message-file message-file-missing'}
            title={
              missing !== null
                ? `${info.name}\n\n${missing}`
                : lines !== null
                  ? `${info.name}\n\n${lines}`
                  : info.name
            }
          >
            {picture !== null && missing === null ? (
              <img className="attachment-thumb" src={picture} alt="" />
            ) : (
              <span className="attachment-icon" aria-hidden="true">
                {info.kind === 'image' ? 'IMG' : info.kind === 'pdf' ? 'PDF' : 'TXT'}
              </span>
            )}
            <span className="attachment-text">
              <span className="attachment-name">{info.name}</span>
              <span className="attachment-facts">
                {missing !== null ? 'cannot be read any more' : factsOf(info)}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export default MessageFiles
