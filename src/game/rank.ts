import { config } from './config'

export type Rank = 'S' | 'A' | 'B'

/** S is a clear in the S window with no hits. A is any other clear inside the A window. B is every other clear. */
export function rankFor(cleared: boolean, time: number, hits: number): Rank | null {
  if (!cleared) return null
  if (time <= config.rank.sMaxClearSec && hits <= config.rank.sMaxHits) return 'S'
  if (time <= config.rank.aMaxClearSec) return 'A'
  return 'B'
}
