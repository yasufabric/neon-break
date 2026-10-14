import { config, expectedClearSeconds } from './config'
import { createFight, grantJustDodge, IDLE_INPUT, stepFight } from './fight'

export { expectedClearSeconds }

/** Steps a hit-rate-100% fight and injects non-overlapping just dodges. */
export function simulateClearTime(justDodges: number): number {
  const fight = createFight({
    w: config.reference.width,
    h: config.reference.height,
    attacksEnabled: false,
  })
  fight.mode = 'play'
  const spacing =
    config.justDodge.slowMoSec +
    config.justDodge.boostSec +
    config.clearSim.triggerSpacingPadSec
  const triggers: number[] = []
  for (let i = 0; i < justDodges; i++) {
    triggers.push(config.clearSim.firstTriggerSec + i * spacing)
  }
  let next = 0
  const dt = 1 / 60
  let guard = 0
  while (fight.mode === 'play') {
    if (guard++ > 60 * 200) {
      throw new Error(`clear sim did not finish (hp ${fight.bossHp.toFixed(2)})`)
    }
    if (next < triggers.length && fight.time >= triggers[next]! - 1e-9) {
      grantJustDodge(fight)
      next += 1
    }
    stepFight(fight, IDLE_INPUT, dt)
  }
  return fight.time
}
