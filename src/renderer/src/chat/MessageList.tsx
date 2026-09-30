function MessageList(): React.JSX.Element {
  return (
    <div className="message-list" role="log" aria-label="Conversation">
      <p className="empty-state">
        No model is connected yet. Type a message and it will be echoed back.
      </p>
    </div>
  )
}

export default MessageList
