import { useState } from 'react'
import ChatView from './chat/ChatView'
import SettingsDialog from './settings/SettingsDialog'
import { useSettingsStatus } from './settings/useSettingsStatus'

function App(): React.JSX.Element {
  const { status, loadError, setStatus } = useSettingsStatus()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Frontier App</h1>
        <div className="app-header-actions">
          <span
            className="app-badge"
            title="No model is connected yet. Replies just repeat your message."
          >
            Echo mode
          </span>
          <button type="button" className="header-button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>
      <ChatView />
      <SettingsDialog
        open={settingsOpen}
        status={status}
        loadError={loadError}
        onStatusChange={setStatus}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}

export default App
