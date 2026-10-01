import rankingsFile from '../../registry/rankings.json'
import { parseRankings, type RankingsResult } from '../shared/rankings'

// registry/rankings.json is built into the app, like registry/models.json (D-014), and checked once, when this
// module first loads. Unlike the registry it is optional: if it is broken, the app says so in the log and offers no
// suggestions, and the chat is not affected (D-023).
const loaded: RankingsResult = parseRankings(rankingsFile)

export function getRankings(): RankingsResult {
  return loaded
}

/** Puts whatever is wrong with the rankings file in the log. Called once, at startup. */
export function reportRankingsProblems(): void {
  if (!loaded.ok) console.error(`registry/rankings.json cannot be used: ${loaded.error}`)
  for (const problem of loaded.problems) console.warn(`registry/rankings.json: ${problem}`)
}
