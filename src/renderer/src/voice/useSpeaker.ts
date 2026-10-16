import { useSyncExternalStore } from 'react'
import { speaker, type SpeakerState } from './speaker'

/** What is being read aloud, and the last notice about a reading (Stage 15.6, D-047). */
export function useSpeaker(): SpeakerState {
  return useSyncExternalStore(speaker.subscribe, speaker.state)
}
