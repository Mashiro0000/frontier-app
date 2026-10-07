import { useCallback, useEffect, useState } from 'react'
import type { Project, ProjectsStatus } from '../../../shared/projects'

export interface ProjectsState {
  /** The projects as main has them (D-039), or null until main has answered (or if it could not). */
  status: ProjectsStatus | null
  setStatus: (status: ProjectsStatus) => void
  /** Asks main again: when the Projects dialog opens, so that it shows what is really kept. */
  reload: () => void
}

/** Asks main for the projects when the window opens, and again on `reload`. */
export function useProjects(): ProjectsState {
  const [status, setStatus] = useState<ProjectsStatus | null>(null)

  const reload = useCallback((): void => {
    if (!window.api) return // the preload did not load: the app says so elsewhere (useSettingsStatus)
    window.api.projects.status().then(setStatus, () => setStatus(null))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { status, setStatus, reload }
}

/** The project a chat belongs to, if it is still there (a deleted project's chats belong to none). */
export const projectOf = (status: ProjectsStatus | null, id: string | null): Project | null =>
  id === null ? null : (status?.projects.find((project) => project.id === id) ?? null)
