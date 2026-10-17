import { app } from 'electron'
import { pinnedDataFolder } from './dataFolderRule'

// Pins the installed app's data folder to %APPDATA%\frontier-app (18.1, D-050; the rule is in
// dataFolderRule.ts). Imported first by index.ts, before anything reads the path.
const pinned = pinnedDataFolder({
  isPackaged: app.isPackaged,
  hasUserDataSwitch: app.commandLine.hasSwitch('user-data-dir'),
  appData: app.getPath('appData')
})
if (pinned) app.setPath('userData', pinned)
