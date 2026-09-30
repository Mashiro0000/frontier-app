import { useState } from 'react'

function Composer(): React.JSX.Element {
  const [text, setText] = useState('')

  return (
    <form className="composer" onSubmit={(event) => event.preventDefault()}>
      <div className="composer-inner">
        <textarea
          className="composer-input"
          rows={1}
          value={text}
          placeholder="Type a message"
          aria-label="Message"
          autoFocus
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="composer-button" disabled={text.trim() === ''}>
          Send
        </button>
      </div>
    </form>
  )
}

export default Composer
