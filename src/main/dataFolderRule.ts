import { win32 } from 'path'

// The rule behind dataFolder.ts (18.1, D-050), without Electron so it can be checked under plain Node.
// Electron names the data folder after the app: in development that is the package name, "frontier-app",
// but a packaged build is named after the product, "Frontier App", and would open an empty profile next
// to the real one. So the installed app is pointed at %APPDATA%\frontier-app, where the chats, keys,
// limits and settings already are. A --user-data-dir given on the command line (the checks' scratch
// profiles) still wins, and development is left as it is.
export const DATA_FOLDER_NAME = 'frontier-app'

export interface DataFolderFacts {
  isPackaged: boolean
  hasUserDataSwitch: boolean
  appData: string
}

/** The folder to set as userData, or null to leave Electron's choice alone. */
export function pinnedDataFolder(facts: DataFolderFacts): string | null {
  if (!facts.isPackaged || facts.hasUserDataSwitch) return null
  return win32.join(facts.appData, DATA_FOLDER_NAME)
}
