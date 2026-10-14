import { config } from './config'
import { createFight, type Fight, type FrameInput, stepFight } from './fight'
import { rankFor, type Rank } from './rank'
import type { Mode } from './types'

export interface BotReport {
  mode: Mode
  time: number
  hits: number
  justDodges: number
  rank: Rank | null
  bossHp: number
}

/**
 * Dashes the moment the cooldown allows, alternating left and right.
 * Never reads telegraphs, never drags, never aims the dash at an attack.
 */
export function blindDashInput(fight: Fight): FrameInput {
  const player = fight.player
  if (player.dashT > 0 || player.dashCooldown > 0) {
    return {
      dragging: false,
      dragX: 0,
      dragY: 0,
      released: false,
      releaseSpeed: 0,
      releaseDirX: 1,
      releaseDirY: 0,
      tap: false,
    }
  }
  const dir = player.dashesStarted % 2 === 0 ? 1 : -1
  return {
    dragging: false,
    dragX: 0,
    dragY: 0,
    released: true,
    releaseSpeed: config.dash.flickSpeedWidthsPerSec * fight.w + 1,
    releaseDirX: dir,
    releaseDirY: 0,
    tap: false,
  }
}

export function runBlindDashBot(): BotReport {
  const fight = createFight({
    w: config.reference.width,
    h: config.reference.height,
    attacksEnabled: true,
  })
  fight.mode = 'play'
  const dt = 1 / 60
  let guard = 0
  while (fight.mode === 'play') {
    if (guard++ > 60 * 180) break
    stepFight(fight, blindDashInput(fight), dt)
  }
  return {
    mode: fight.mode,
    time: fight.time,
    hits: fight.player.hits,
    justDodges: fight.justDodges,
    rank: rankFor(fight.bossHp <= 0, fight.time, fight.player.hits),
    bossHp: fight.bossHp,
  }
}
