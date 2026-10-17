import { describe, expect, it } from 'vitest'
import { runFrequentGrazeBot, runNoGrazeBot, runRandomDragBot } from '../src/game/bot'
import { simulateClearTime } from '../src/game/clear-sim'
import {
  config,
  expectedClearSeconds,
  grazeRadius,
  hitboxRadius,
  projectileSpeed,
  spriteSize,
} from '../src/game/config'
import {
  createFight,
  IDLE_INPUT,
  stepFight,
  type Fight,
  type FrameInput,
} from '../src/game/fight'
import { nextQuality, type QualityState } from '../src/game/quality'
import { rankFor } from '../src/game/rank'
import { emptySave, recordRun } from '../src/persist'
import type { BulletHazard } from '../src/game/types'

function advance(fight: Fight, seconds: number, input: FrameInput = IDLE_INPUT): void {
  let left = seconds
  while (left > 1e-9) {
    const dt = Math.min(left, config.sim.maxFrameSec)
    stepFight(fight, input, dt)
    left -= dt
  }
}

function playing(w = config.reference.width, h = config.reference.height, bossHp?: number): Fight {
  const fight = createFight({ w, h, attacksEnabled: false, bossHp })
  fight.mode = 'play'
  return fight
}

function parkBullet(fight: Fight, x = fight.player.x, y = fight.player.y): BulletHazard {
  const bullet: BulletHazard = {
    type: 'bullet',
    id: fight.nextId++,
    kind: 'straight',
    x,
    y,
    px: x,
    py: y,
    vx: 0,
    vy: 0,
    r: hitboxRadius(fight.w),
    homingT: 0,
    life: 30,
    grazeCooldown: 0,
    grazePass: false,
    didHit: false,
  }
  fight.attacks.push(bullet)
  return bullet
}

function dragShip(fight: Fight, x: number, y: number): FrameInput {
  return {
    dragging: true,
    fingerX: x,
    fingerY: y + config.player.hoverWidths * fight.w,
    tap: false,
  }
}

describe('hitbox', () => {
  it('is a circle whose diameter is 30% of the sprite', () => {
    const width = 390
    expect(spriteSize(width)).toBeCloseTo(width * 0.16)
    expect(hitboxRadius(width) * 2).toBeCloseTo(spriteSize(width) * 0.3)
  })
})

describe('movement', () => {
  it('sits 0.12W above the finger and matches a full-screen drag in one frame', () => {
    const fight = playing()
    const x = fight.w * 0.2
    const y = fight.h * 0.7
    stepFight(fight, dragShip(fight, x, y), 0.016)
    expect(fight.player.x).toBeCloseTo(x)
    expect(fight.player.y).toBeCloseTo(y)
    const farX = fight.w * 0.84
    stepFight(fight, dragShip(fight, farX, y), 0.016)
    expect(fight.player.x).toBeCloseTo(farX)
    expect(fight.player.y).toBeCloseTo(y)
    expect(fight.player.y).toBeCloseTo(
      y + config.player.hoverWidths * fight.w - config.player.hoverWidths * fight.w,
    )
  })
})

describe('graze', () => {
  it('triggers when an attack is inside 2.5 hitbox radii and outside the hitbox', () => {
    const fight = playing()
    const bullet = parkBullet(fight, fight.player.x, fight.player.y)
    const gap = (hitboxRadius(fight.w) + grazeRadius(fight.w)) / 2 + bullet.r
    bullet.x = fight.player.x + gap
    bullet.px = bullet.x
    const hp = fight.player.hp
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.justDodges).toBe(1)
    expect(fight.player.hp).toBe(hp)
    expect(fight.slowT).toBeGreaterThan(config.justDodge.slowMoSec - 0.02)
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.justDodges).toBe(1)
  })

  it('does not let one bullet chain grazes during its cooldown', () => {
    const fight = playing()
    const bullet = parkBullet(fight, fight.player.x, fight.player.y)
    const gap = (hitboxRadius(fight.w) + grazeRadius(fight.w)) / 2 + bullet.r
    bullet.x = fight.player.x + gap
    bullet.px = bullet.x
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.justDodges).toBe(1)
    advance(fight, config.graze.cooldownSec * 0.5)
    expect(fight.justDodges).toBe(1)
    advance(fight, config.graze.cooldownSec)
    expect(fight.justDodges).toBe(2)
  })

  it('still hurts on a real overlap and does not also graze', () => {
    const fight = playing()
    parkBullet(fight)
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.player.hp).toBe(config.player.hitPoints - 1)
    expect(fight.justDodges).toBe(0)
  })

  it('never lets one bullet both graze and hit on the same pass', () => {
    const fight = playing()
    const bullet = parkBullet(fight, fight.player.x, fight.player.y)
    const gap = (hitboxRadius(fight.w) + grazeRadius(fight.w)) / 2 + bullet.r
    bullet.x = fight.player.x + gap
    bullet.px = bullet.x
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.justDodges).toBe(1)
    expect(fight.player.hp).toBe(config.player.hitPoints)
    advance(fight, config.justDodge.hitStopSec)

    bullet.x = fight.player.x
    bullet.px = bullet.x
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.player.hp).toBe(config.player.hitPoints)
    expect(fight.player.hits).toBe(0)
    expect(fight.justDodges).toBe(1)

    const clear = fight.player.x + grazeRadius(fight.w) + bullet.r + 30
    bullet.x = clear
    bullet.px = clear
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.player.hp).toBe(config.player.hitPoints)
    expect(fight.justDodges).toBe(1)

    bullet.x = fight.player.x
    bullet.px = fight.player.x
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.player.hp).toBe(config.player.hitPoints - 1)
    expect(fight.player.hits).toBe(1)
    expect(fight.justDodges).toBe(1)

    bullet.x = fight.player.x + gap
    bullet.px = bullet.x
    advance(fight, 0.25)
    expect(fight.justDodges).toBe(1)
    expect(fight.player.hp).toBe(config.player.hitPoints - 1)
  })
})

describe('damage', () => {
  it('hurts when an attack overlaps outside a dash', () => {
    const fight = playing()
    parkBullet(fight)
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.player.hp).toBe(config.player.hitPoints - 1)
    expect(fight.player.hits).toBe(1)
    expect(fight.justDodges).toBe(0)
  })

  it('freezes the attack that hit for 0.2s and marks it white', () => {
    const fight = playing()
    const bullet = parkBullet(fight)
    bullet.vy = 80
    stepFight(fight, IDLE_INPUT, 0.016)
    const y = bullet.y
    expect(bullet.frozenT).toBeGreaterThan(config.hit.freezeSec - 0.02)
    expect(bullet.whiteT).toBeGreaterThan(0)
    advance(fight, config.hit.freezeSec * 0.5)
    expect(bullet.y).toBeCloseTo(y)
    advance(fight, config.hit.freezeSec)
    expect(bullet.y).toBeGreaterThan(y + 1)
  })

  it('ignores overlaps for 1s after a hit and dies when the hearts are gone', () => {
    const fight = playing()
    for (let heart = config.player.hitPoints; heart > 0; heart--) {
      parkBullet(fight)
      const result = stepFight(fight, IDLE_INPUT, 0.016)
      expect(fight.player.hp).toBe(heart - 1)
      fight.attacks = []
      if (heart > 1) {
        expect(result.died).toBe(false)
        parkBullet(fight)
        stepFight(fight, IDLE_INPUT, 0.016)
        expect(fight.player.hp).toBe(heart - 1)
        fight.attacks = []
        advance(fight, config.player.hitInvulnSec)
      } else {
        expect(result.died).toBe(true)
        expect(fight.mode).toBe('dead')
      }
    }
    expect(fight.player.hits).toBe(config.player.hitPoints)
  })

  it('restarts instantly on tap', () => {
    const fight = playing()
    fight.mode = 'dead'
    fight.player.hp = 0
    fight.time = 12
    const result = stepFight(fight, { ...IDLE_INPUT, tap: true }, 0.016)
    expect(result.retried).toBe(true)
    expect(fight.mode).toBe('play')
    expect(fight.player.hp).toBe(config.player.hitPoints)
    expect(fight.time).toBe(0)
  })
})

describe('just dodge payoff', () => {
  it('slows for 0.3s and then deals boosted DPS for the boost window', () => {
    const fight = playing()
    const bullet = parkBullet(fight, fight.player.x, fight.player.y)
    const gap = (hitboxRadius(fight.w) + grazeRadius(fight.w)) / 2 + bullet.r
    bullet.x = fight.player.x + gap
    bullet.px = bullet.x
    stepFight(fight, IDLE_INPUT, 0.02)
    expect(fight.slowT).toBeGreaterThan(config.justDodge.slowMoSec - 0.03)
    expect(fight.boostT).toBe(0)
    advance(fight, config.justDodge.slowMoSec)
    expect(fight.slowT).toBe(0)
    expect(fight.boostT).toBeGreaterThan(config.justDodge.boostSec - 0.05)
    const before = fight.bossHp
    advance(fight, 0.5)
    const dealt = before - fight.bossHp
    expect(dealt).toBeGreaterThan(config.player.boostedDps * 0.45)
    expect(dealt).toBeLessThan(config.player.boostedDps * 0.55)
  })
})

describe('boss script', () => {
  it('telegraphs 0.9s and leaves a 1.2s gap above half HP', () => {
    const fight = createFight({
      w: config.reference.width,
      h: config.reference.height,
      attacksEnabled: true,
    })
    fight.mode = 'play'
    expect(fight.telegraph?.kinds).toEqual(['straight'])
    advance(fight, config.boss.telegraphSec)
    expect(fight.telegraph).toBeNull()
    expect(fight.attacks.some((hazard) => hazard.kind === 'straight')).toBe(true)
    expect(fight.attacks.some((hazard) => hazard.kind === 'laser')).toBe(false)
    expect(fight.gapRemaining).toBeCloseTo(config.boss.gapSec, 5)
  })

  it('uses a 0.8s gap and two attack types under half HP', () => {
    const fight = createFight({
      w: config.reference.width,
      h: config.reference.height,
      attacksEnabled: true,
      bossHp: config.boss.hp * 0.4,
    })
    fight.mode = 'play'
    expect(fight.phase).toBe(2)
    expect(fight.telegraph?.kinds).toEqual(['straight', 'missile'])
    advance(fight, config.boss.telegraphSec)
    expect(fight.attacks.some((hazard) => hazard.kind === 'straight')).toBe(true)
    expect(fight.attacks.some((hazard) => hazard.kind === 'missile')).toBe(true)
    expect(fight.gapRemaining).toBeCloseTo(config.boss.enragedGapSec, 5)
  })

  it('locks a missile onto a straight line after the homing window', () => {
    const fight = createFight({
      w: config.reference.width,
      h: config.reference.height,
      attacksEnabled: true,
      bossHp: config.boss.hp * 0.4,
    })
    fight.mode = 'play'
    advance(fight, config.boss.telegraphSec)
    const missile = fight.attacks.find((hazard) => hazard.kind === 'missile')
    expect(missile).toBeTruthy()
    if (!missile || missile.type !== 'bullet') throw new Error('missing missile')
    expect(missile.homingT).toBeGreaterThan(config.boss.missileHomingSec - config.sim.maxFrameSec - 0.001)
    expect(missile.homingT).toBeLessThanOrEqual(config.boss.missileHomingSec)
    advance(fight, config.boss.missileHomingSec + 0.05)
    expect(missile.homingT).toBe(0)
    const speed = Math.hypot(missile.vx, missile.vy)
    expect(speed).toBeCloseTo(
      projectileSpeed(fight.w, config.boss.missileBoostSpeedWidthsPerSec),
      0,
    )
  })
})

describe('rank', () => {
  it('gives S only for a fast clear with zero hits', () => {
    expect(rankFor(true, config.rank.sMaxClearSec, 0)).toBe('S')
    expect(rankFor(true, config.rank.sMaxClearSec, 1)).toBe('A')
    expect(rankFor(true, config.rank.sMaxClearSec + 0.01, 0)).toBe('A')
    expect(rankFor(true, config.rank.aMaxClearSec, 2)).toBe('A')
    expect(rankFor(true, config.rank.aMaxClearSec + 0.01, 0)).toBe('B')
    expect(rankFor(false, 20, 0)).toBeNull()
  })
})

describe('clear time', () => {
  it('lands near 110s / 80s / 55s for 0 / 5 / 10 grazes', () => {
    const counts = [0, 5, 10]
    const targets = [110, 80, 55]
    const tolerance = 5
    const times = counts.map((count) => simulateClearTime(count))
    console.log(`CLEAR_TIMES ${times.map((time) => time.toFixed(4)).join(' ')}`)
    counts.forEach((count, index) => {
      const target = targets[index]!
      expect(Math.abs(expectedClearSeconds(count) - target)).toBeLessThanOrEqual(tolerance)
      expect(Math.abs(times[index]! - target)).toBeLessThanOrEqual(tolerance)
      expect(times[index]).toBeCloseTo(expectedClearSeconds(count), 2)
    })
    expect(times[0]).toBeGreaterThan(times[1]!)
    expect(times[1]).toBeGreaterThan(times[2]!)
    expect(rankFor(true, times[0]!, 0)).toBe('B')
    expect(rankFor(true, times[1]!, 0)).toBe('A')
    expect(rankFor(true, times[2]!, 0)).toBe('S')
    expect(rankFor(true, times[2]!, 1)).not.toBe('S')
  })
})

describe('drag bots', () => {
  it('clears faster when it grazes, and a random drag dies', () => {
    const none = runNoGrazeBot()
    const frequent = runFrequentGrazeBot()
    const random = runRandomDragBot()
    console.log(`NO_GRAZE ${JSON.stringify(none)}`)
    console.log(`FREQUENT_GRAZE ${JSON.stringify(frequent)}`)
    console.log(`RANDOM_DRAG ${JSON.stringify(random)}`)
    expect(none.mode).toBe('clear')
    expect(none.time).toBeGreaterThan(70)
    expect(none.time).toBeLessThan(95)
    expect(frequent.mode).toBe('clear')
    expect(frequent.time).toBeGreaterThan(40)
    expect(frequent.time).toBeLessThan(60)
    expect(frequent.time).toBeLessThan(none.time - 20)
    if (frequent.hits === 0) expect(frequent.rank).toBe('S')
    else expect(frequent.rank).not.toBe('S')
    expect(random.mode).toBe('dead')
    expect(random.hits).toBe(config.player.hitPoints)
    expect(random.time).toBeGreaterThan(25)
    expect(random.time).toBeLessThan(55)
  })
})

describe('local best', () => {
  it('keeps the faster clear and the highest just-dodge count', () => {
    let save = recordRun(emptySave(), 80, 5, true)
    save = recordRun(save, 110, 2, true)
    save = recordRun(save, 30, 9, false)
    expect(save.bestTime).toBe(80)
    expect(save.bestJust).toBe(9)
  })
})

describe('quality', () => {
  it('drops bloom after a run of slow frames', () => {
    let state: QualityState = { quality: 'high', recent: [] }
    for (let i = 0; i < config.render.slowFrameCount - 1; i++) {
      state = nextQuality(state, config.render.slowFrameMs + 1)
    }
    expect(state.quality).toBe('high')
    state = nextQuality(state, 12)
    expect(state.quality).toBe('low')
    const mixed: QualityState = {
      quality: 'high',
      recent: [
        ...Array.from({ length: 20 }, () => 40),
        ...Array.from({ length: config.render.slowFrameCount - 21 }, () => 10),
      ],
    }
    expect(nextQuality(mixed, 10).quality).toBe('high')
    state = {
      quality: 'low',
      recent: Array.from({ length: config.render.slowFrameCount - 1 }, () => 40),
    }
    state = nextQuality(state, 40)
    expect(state.quality).toBe('off')
    state = nextQuality(state, 10)
    expect(state.recent).toEqual([10])
  })
})
