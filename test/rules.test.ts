import { describe, expect, it } from 'vitest'
import { runBlindDashBot } from '../src/game/bot'
import { simulateClearTime } from '../src/game/clear-sim'
import {
  config,
  dashDistance,
  expectedClearSeconds,
  flickThreshold,
  hitboxRadius,
  spriteSize,
} from '../src/game/config'
import {
  createFight,
  IDLE_INPUT,
  stepFight,
  type Fight,
  type FrameInput,
} from '../src/game/fight'
import { flickOnRelease } from '../src/game/input'
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
    justDodgeDashId: 0,
    didHit: false,
  }
  fight.attacks.push(bullet)
  return bullet
}

function release(speed: number, dirX = 1, dirY = 0): FrameInput {
  return {
    dragging: false,
    dragX: 0,
    dragY: 0,
    released: true,
    releaseSpeed: speed,
    releaseDirX: dirX,
    releaseDirY: dirY,
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
  it('follows the finger delta and never teleports past max speed', () => {
    const fight = playing(100, 200)
    const start = fight.player.x
    const dt = config.sim.maxFrameSec
    const drag = { ...IDLE_INPUT, dragging: true, dragX: 10_000, dragY: 0 }
    stepFight(fight, drag, dt)
    const cap = config.player.maxSpeedWidthsPerSec * fight.w * dt
    expect(fight.player.x - start).toBeCloseTo(cap)
    stepFight(fight, drag, dt)
    expect(fight.player.x - start).toBeCloseTo(cap * 2)
    expect(fight.player.x).toBeLessThan(5_000)
  })

  it('does not dash in the middle of a drag', () => {
    const fight = playing()
    stepFight(
      fight,
      {
        ...IDLE_INPUT,
        dragging: true,
        dragX: 4,
        releaseSpeed: flickThreshold(fight.w) * 4,
        released: false,
      },
      0.016,
    )
    expect(fight.player.dashT).toBe(0)
    expect(fight.player.dashesStarted).toBe(0)
  })
})

describe('flick', () => {
  it('dashes only when release speed over the last 0.06s is above 2.5W/s', () => {
    const width = 200
    const windowSec = config.dash.flickWindowSec
    const above = flickThreshold(width) * windowSec + 1
    const exact = flickThreshold(width) * windowSec
    expect(
      flickOnRelease([{ x: 0, y: 0, t: 0 }], above, 0, windowSec, width).dash,
    ).toBe(true)
    expect(
      flickOnRelease([{ x: 0, y: 0, t: 0 }], exact, 0, windowSec, width).dash,
    ).toBe(false)
  })
})

describe('dash', () => {
  it('covers 0.25W in 0.15s and then waits 1.0s when it was not a just dodge', () => {
    const fight = playing()
    const start = fight.player.x
    const speed = flickThreshold(fight.w) + 10
    stepFight(fight, release(speed), config.sim.maxFrameSec)
    advance(fight, config.dash.durationSec - config.sim.maxFrameSec)
    expect(fight.player.x - start).toBeCloseTo(dashDistance(fight.w), 4)
    expect(fight.player.dashT).toBe(0)
    expect(fight.player.dashCooldown).toBeCloseTo(config.dash.cooldownSec)
  })

  it('is invincible for the dash and a real overlap is a just dodge', () => {
    const fight = playing()
    parkBullet(fight)
    const hp = fight.player.hp
    stepFight(fight, release(flickThreshold(fight.w) + 5), 0.02)
    expect(fight.justDodges).toBe(1)
    expect(fight.player.hp).toBe(hp)
    expect(fight.player.dashCooldown).toBe(config.dash.justDodgeCooldownSec)
    expect(fight.slowT).toBeGreaterThan(0)
    stepFight(fight, IDLE_INPUT, 0.02)
    expect(fight.justDodges).toBe(1)
  })

  it('does not start another dash until the current one finishes', () => {
    const fight = playing()
    const speed = flickThreshold(fight.w) + 5
    stepFight(fight, release(speed), 0.02)
    stepFight(fight, release(speed), 0.02)
    expect(fight.player.dashesStarted).toBe(1)
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

  it('ignores overlaps for 1s after a hit and dies on the third hit', () => {
    const fight = playing()
    parkBullet(fight)
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.player.hp).toBe(2)
    fight.attacks = []
    parkBullet(fight)
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.player.hp).toBe(2)
    fight.attacks = []
    advance(fight, config.player.hitInvulnSec)
    parkBullet(fight)
    stepFight(fight, IDLE_INPUT, 0.016)
    expect(fight.player.hp).toBe(1)
    fight.attacks = []
    advance(fight, config.player.hitInvulnSec)
    parkBullet(fight)
    const result = stepFight(fight, IDLE_INPUT, 0.016)
    expect(result.died).toBe(true)
    expect(fight.mode).toBe('dead')
    expect(fight.player.hits).toBe(3)
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
  it('slows for 0.3s and then deals 30 DPS for 3s', () => {
    const fight = playing()
    parkBullet(fight)
    stepFight(fight, release(flickThreshold(fight.w) + 5), 0.02)
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
  it('telegraphs 0.6s and leaves a 1.2s gap above half HP', () => {
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
    expect(speed).toBeCloseTo(config.boss.missileBoostSpeedWidthsPerSec * fight.w, 0)
  })
})

describe('rank', () => {
  it('gives S only for a clear at or under 55s with zero hits', () => {
    expect(rankFor(true, 55, 0)).toBe('S')
    expect(rankFor(true, 55, 1)).toBe('A')
    expect(rankFor(true, 55.01, 0)).toBe('A')
    expect(rankFor(true, 75, 2)).toBe('A')
    expect(rankFor(true, 75.01, 0)).toBe('B')
    expect(rankFor(true, 110, 0)).toBe('B')
    expect(rankFor(false, 20, 0)).toBeNull()
  })
})

describe('clear time', () => {
  it('reports 110s / 80s / 50s for 0 / 5 / 10 just dodges', () => {
    expect(expectedClearSeconds(0)).toBe(110)
    expect(expectedClearSeconds(5)).toBe(80)
    expect(expectedClearSeconds(10)).toBe(50)
    const times = [0, 5, 10].map((count) => simulateClearTime(count))
    console.log(
      `CLEAR_TIMES ${times.map((time) => time.toFixed(4)).join(' ')}`,
    )
    expect(times[0]).toBeCloseTo(110, 3)
    expect(times[1]).toBeCloseTo(80, 3)
    expect(times[2]).toBeCloseTo(50, 3)
    expect(rankFor(true, times[0]!, 0)).toBe('B')
    expect(rankFor(true, times[1]!, 0)).toBe('B')
    expect(rankFor(true, times[2]!, 0)).toBe('S')
  })
})

describe('blind dash bot', () => {
  it('does not earn S by dashing on cooldown without reading telegraphs', () => {
    const report = runBlindDashBot()
    console.log(`BLIND_BOT ${JSON.stringify(report)}`)
    expect(report.rank).not.toBe('S')
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
