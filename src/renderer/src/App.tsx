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
          {status?.hasKey === true && (
            <span
              className="app-badge"
              title={`Replies come from ${status.provider}'s ${status.modelLabel}.`}
            >
              {status.modelLabel}
            </span>
          )}
          {status?.hasKey === false && (
            <span
              className="app-badge app-badge-warn"
              title="Open Settings to add your Anthropic API key."
            >
              No API key
            </span>
          )}
          <button type="button" className="header-button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>
      <ChatView status={status} onOpenSettings={() => setSettingsOpen(true)} />
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
