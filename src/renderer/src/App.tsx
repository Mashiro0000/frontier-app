import ChatView from './chat/ChatView'

function App(): React.JSX.Element {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Frontier App</h1>
        <span
          className="app-badge"
          title="No model is connected yet. Replies just repeat your message."
        >
          Echo mode
        </span>
      </header>
      <ChatView />
    </div>
  )
}

export default App
