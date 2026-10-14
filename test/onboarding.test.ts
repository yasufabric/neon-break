import { describe, expect, it } from 'vitest'
import { config, flickThreshold, hitboxRadius } from '../src/game/config'
import { createFight, IDLE_INPUT, stepFight, type Fight, type FrameInput } from '../src/game/fight'
import { tutorialStraightStarts } from '../src/game/onboarding'
import { readOnboardingDone, writeOnboardingDone, type KeyValue } from '../src/persist'
import type { BulletHazard } from '../src/game/types'

function memory(): KeyValue & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem(key) {
      return map.get(key) ?? null
    },
    setItem(key, value) {
      map.set(key, value)
    },
  }
}

function firstRun(): Fight {
  return createFight({
    w: config.reference.width,
    h: config.reference.height,
    attacksEnabled: true,
    onboarding: true,
  })
}

function step(fight: Fight, input: FrameInput = IDLE_INPUT): void {
  stepFight(fight, input, config.sim.maxFrameSec)
}

function release(): FrameInput {
  return {
    ...IDLE_INPUT,
    released: true,
    releaseSpeed: flickThreshold(config.reference.width) + 40,
    releaseDirX: 1,
  }
}

function parkOffTheLine(fight: Fight): void {
  const unsafe: number[] = []
  for (const hazard of fight.attacks) {
    if (hazard.type === 'bullet') unsafe.push(hazard.x)
  }
  if (fight.telegraph?.tutorial === 'line' && fight.telegraph.aimX !== undefined) {
    unsafe.push(fight.telegraph.aimX)
  }
  const radius = hitboxRadius(fight.w) + config.boss.straightRadiusWidths * fight.w + 12
  const options = [0.18, 0.5, 0.82].map((fraction) => fight.w * fraction)
  const next = options.find((x) => unsafe.every((column) => Math.abs(column - x) > radius))
  if (next !== undefined) fight.player.x = next
}

function advanceTo(fight: Fight, time: number, dodge = false): void {
  let guard = 0
  while (fight.time < time - 1e-8) {
    if (guard++ > 20000) throw new Error(`stuck at ${fight.time}`)
    step(fight)
    if (dodge) {
      fight.player.hitInvuln = 1
      parkOffTheLine(fight)
    }
    if (fight.mode !== 'play') throw new Error(`left play at ${fight.time} hp ${fight.player.hp}`)
  }
}

describe('onboarding timeline', () => {
  it('shows nothing, then aimed slow shots, then one laser, then the normal script', () => {
    expect(tutorialStraightStarts()).toEqual([4, 6, 8, 10])
    const fight = firstRun()
    expect(fight.mode).toBe('play')
    expect(fight.telegraph).toBeNull()
    expect(fight.attacks).toHaveLength(0)

    advanceTo(fight, 3.9)
    expect(fight.attacks).toHaveLength(0)
    expect(fight.telegraph).toBeNull()
    expect(fight.calmChunks).toBe(3)
    expect(fight.tutorialShotsFired).toBe(0)
    const dropped = config.boss.hp - fight.bossHp
    const auto = fight.time * config.player.dps
    expect(dropped).toBeCloseTo(auto + 3 * config.onboarding.calmChunkHp, 0)

    advanceTo(fight, 4.7, true)
    expect(fight.telegraph?.tutorial === 'line' || fight.tutorialShotsFired >= 1).toBe(true)

    advanceTo(fight, 11.7, true)
    expect(fight.tutorialShotsFired).toBe(tutorialStraightStarts().length)
    expect(fight.tutorialLasersFired).toBe(0)
    expect(fight.attacks.every((hazard) => hazard.kind === 'straight')).toBe(true)
    const shot = fight.attacks.find((hazard) => hazard.type === 'bullet')
    expect(shot && shot.type === 'bullet').toBe(true)
    if (shot && shot.type === 'bullet') {
      const speed = Math.hypot(shot.vx, shot.vy)
      expect(speed).toBeCloseTo(
        config.boss.straightSpeedWidthsPerSec * fight.w * config.onboarding.bulletSpeedScale,
        4,
      )
    }

    advanceTo(fight, 13, true)
    expect(fight.tutorialLasersFired).toBe(1)
    expect(fight.tutorialShotsFired).toBe(4)
    expect(fight.attacks.filter((hazard) => hazard.kind === 'laser')).toHaveLength(1)
    expect(fight.attacks.some((hazard) => hazard.kind === 'straight')).toBe(false)
    expect(fight.telegraph?.tutorial).not.toBe('band')

    advanceTo(fight, 20.2, true)
    expect(fight.onboardingDone).toBe(true)
    expect(fight.tutorialLasersFired).toBe(1)
    expect(fight.attacks.some((hazard) => hazard.kind === 'missile')).toBe(false)
    expect(fight.telegraph?.kinds.includes('missile')).not.toBe(true)
    expect(fight.bossHp / fight.bossMaxHp).toBeGreaterThan(config.boss.enrageHpFraction)
  })

  it('lets a last-moment flick just-dodge the aimed tutorial shot', () => {
    const fight = firstRun()
    const radius = hitboxRadius(fight.w)
    const graze = config.onboarding.flickGrazeWidths * fight.w
    let guard = 0
    while (guard++ < 60 * 30) {
      const bullet = fight.attacks.find(
        (hazard): hazard is BulletHazard => hazard.type === 'bullet' && hazard.kind === 'straight',
      )
      if (bullet) {
        const dist = Math.hypot(bullet.x - fight.player.x, bullet.y - fight.player.y)
        const touch = radius + bullet.r
        if (dist <= graze && dist > touch + graze * 0.35) {
          step(fight, release())
          expect(fight.justDodges).toBe(1)
          expect(fight.player.hp).toBe(config.player.hitPoints)
          expect(dist).toBeGreaterThan(touch)
          expect(fight.slowT).toBeGreaterThan(config.justDodge.slowMoSec - config.sim.maxFrameSec - 0.001)
          return
        }
      }
      step(fight)
      if (fight.player.hp < config.player.hitPoints) {
        throw new Error(`hit before the flick at t=${fight.time.toFixed(2)}`)
      }
    }
    throw new Error('tutorial bullet never reached the ship')
  })

  it('does not count a flick while the aimed shot is still far away', () => {
    const fight = firstRun()
    const graze = config.onboarding.flickGrazeWidths * fight.w
    let guard = 0
    while (guard++ < 60 * 30) {
      const bullet = fight.attacks.find(
        (hazard): hazard is BulletHazard => hazard.type === 'bullet' && hazard.kind === 'straight',
      )
      if (bullet) {
        const dist = Math.hypot(bullet.x - fight.player.x, bullet.y - fight.player.y)
        if (dist < graze * 2.2 && dist > graze * 1.6) {
          step(fight, release())
          expect(fight.justDodges).toBe(0)
          expect(fight.player.hp).toBe(config.player.hitPoints)
          return
        }
      }
      step(fight)
    }
    throw new Error('tutorial bullet never entered the early window')
  })
})

describe('onboarding skip flag', () => {
  it('stays off until it is stored, and a stored flag builds a normal fight', () => {
    const storage = memory()
    expect(readOnboardingDone(storage)).toBe(false)
    const first = createFight({
      w: config.reference.width,
      h: config.reference.height,
      attacksEnabled: true,
      onboarding: !readOnboardingDone(storage),
    })
    expect(first.onboarding).toBe(true)
    expect(first.telegraph).toBeNull()

    writeOnboardingDone(storage)
    expect(readOnboardingDone(storage)).toBe(true)
    expect(storage.getItem('neon-break-onboarded')).toBe('1')

    const later = createFight({
      w: config.reference.width,
      h: config.reference.height,
      attacksEnabled: true,
      onboarding: !readOnboardingDone(storage),
    })
    expect(later.onboarding).toBe(false)
    expect(later.mode).toBe('ready')
    expect(later.telegraph?.kinds).toEqual(['straight'])
  })

  it('does not replay the lesson after a retry', () => {
    const fight = firstRun()
    fight.mode = 'dead'
    step(fight, { ...IDLE_INPUT, tap: true })
    expect(fight.onboarding).toBe(false)
    expect(fight.mode).toBe('play')
    expect(fight.telegraph?.kinds).toEqual(['straight'])
  })
})

describe('homing missiles', () => {
  it('stay out of the script until the boss is under half HP', () => {
    const fight = createFight({
      w: config.reference.width,
      h: config.reference.height,
      attacksEnabled: true,
    })
    fight.mode = 'play'
    let guard = 0
    while (fight.time < 8 && guard++ < 20000) {
      fight.player.hitInvuln = 1
      step(fight)
    }
    expect(fight.time).toBeGreaterThan(7)
    expect(fight.bossHp / fight.bossMaxHp).toBeGreaterThan(0.5)
    expect(fight.attacks.some((hazard) => hazard.kind === 'missile')).toBe(false)
    expect(fight.telegraph?.kinds.includes('missile')).not.toBe(true)
  })
})
