import { config, dashDistance, hitboxRadius, maxSpeed } from './config'
import { gapSeconds, moveHazards, openTelegraph, updateSchedule } from './boss'
import type { Fight } from './state'
import type { FrameInput, Hazard, StepResult, Sweep } from './types'

export type { Fight } from './state'
export type { FrameInput, Hazard, Mode, StepResult, Sweep } from './types'

export const IDLE_INPUT: FrameInput = {
  dragging: false,
  dragX: 0,
  dragY: 0,
  released: false,
  releaseSpeed: 0,
  releaseDirX: 1,
  releaseDirY: 0,
  tap: false,
}

export interface CreateOptions {
  w: number
  h: number
  attacksEnabled?: boolean
  bossHp?: number
  /** First run. Starts in play so the 0–4s clock runs before the first touch. */
  onboarding?: boolean
}

export function createFight(options: CreateOptions): Fight {
  const w = options.w
  const h = options.h
  const bossHp = options.bossHp ?? config.boss.hp
  const fight: Fight = {
    w,
    h,
    mode: 'ready',
    time: 0,
    bossHp,
    bossMaxHp: config.boss.hp,
    attacksEnabled: options.attacksEnabled ?? true,
    player: {
      x: w * config.player.spawnXFraction,
      y: h * config.player.spawnYFraction,
      hp: config.player.hitPoints,
      hits: 0,
      hitInvuln: 0,
      dashT: 0,
      dashCooldown: 0,
      dashDirX: 1,
      dashDirY: 0,
      dashId: 0,
      dashJustDodged: false,
      dashesStarted: 0,
    },
    attacks: [],
    telegraph: null,
    gapRemaining: 0,
    patternIndex: 0,
    phase: bossHp / config.boss.hp < config.boss.enrageHpFraction ? 2 : 1,
    laserFromLeft: true,
    nextId: 1,
    justDodges: 0,
    slowT: 0,
    boostT: 0,
    pendingBoost: false,
    shakeT: 0,
    hitStopT: 0,
    flashT: 0,
    sweep: { x0: 0, y0: 0, x1: 0, y1: 0, dashing: false },
    dashEnded: false,
    onboarding: options.onboarding === true,
    onboardingDone: false,
    tutorialSlot: 0,
    tutorialLaserArmed: false,
    tutorialLasersFired: 0,
    tutorialShotsFired: 0,
    barPulse: 0,
    calmChunks: 0,
  }
  fight.player.x = fight.player.x
  clampPlayer(fight)
  if (fight.onboarding) {
    fight.mode = 'play'
  } else if (fight.attacksEnabled) {
    openTelegraph(fight)
  }
  return fight
}

export function resetFight(fight: Fight): void {
  const next = createFight({
    w: fight.w,
    h: fight.h,
    attacksEnabled: fight.attacksEnabled,
    onboarding: false,
  })
  next.mode = 'play'
  Object.assign(fight, next)
}

export function emptyResult(): StepResult {
  return {
    started: false,
    retried: false,
    dashed: false,
    justDodge: false,
    hit: false,
    died: false,
    cleared: false,
    fired: null,
  }
}

export function stepFight(fight: Fight, input: FrameInput, realDt: number): StepResult {
  const result = emptyResult()
  if (realDt <= 0) return result
  const dt = Math.min(realDt, config.sim.maxFrameSec)

  if (fight.mode === 'dead' || fight.mode === 'clear') {
    if (input.tap) {
      resetFight(fight)
      result.retried = true
    }
    return result
  }

  if (fight.mode === 'ready') {
    const engaged = input.tap || input.dragging || input.released
    if (!engaged) return result
    fight.mode = 'play'
    result.started = true
  }

  if (fight.hitStopT > 0) {
    const used = Math.min(dt, fight.hitStopT)
    fight.hitStopT -= used
    decayJuice(fight, used)
    if (applyDamage(fight, used)) result.cleared = true
    const rest = dt - used
    if (rest > 1e-8 && fight.mode === 'play') {
      const restResult = stepFight(fight, { ...input, tap: false }, rest)
      return mergeResult(result, restResult)
    }
    return result
  }

  const worldScale = fight.slowT > 0 ? config.justDodge.slowMoScale : 1
  const worldDt = dt * worldScale

  updatePlayer(fight, input, dt, result)
  const fired = updateSchedule(fight, worldDt)
  if (fired) result.fired = fired
  decayLocks(fight, dt)
  moveHazards(fight, worldDt)
  resolveHits(fight, result)
  finishDash(fight)
  decayJuice(fight, dt)
  if (fight.player.hitInvuln > 0) {
    fight.player.hitInvuln = Math.max(0, fight.player.hitInvuln - dt)
  }
  if (applyDamage(fight, dt)) result.cleared = true
  return result
}

/** The just-dodge payoff: slow-mo, then a full boost window, cooldown cleared. */
export function grantJustDodge(fight: Fight): void {
  fight.justDodges += 1
  fight.slowT = config.justDodge.slowMoSec
  fight.pendingBoost = true
  fight.boostT = 0
  fight.shakeT = config.justDodge.shakeSec
  fight.hitStopT = config.justDodge.hitStopSec
  fight.flashT = config.justDodge.flashSec
  fight.player.dashCooldown = config.dash.justDodgeCooldownSec
  fight.player.dashJustDodged = true
}

function updatePlayer(fight: Fight, input: FrameInput, dt: number, result: StepResult): void {
  const player = fight.player
  if (player.dashCooldown > 0) {
    player.dashCooldown = Math.max(0, player.dashCooldown - dt)
  }

  const wantsDash =
    player.dashT <= 0 &&
    player.dashCooldown <= 0 &&
    input.released &&
    input.releaseSpeed > config.dash.flickSpeedWidthsPerSec * fight.w

  if (wantsDash) beginDash(fight, input.releaseDirX, input.releaseDirY, result)

  fight.sweep = {
    x0: player.x,
    y0: player.y,
    x1: player.x,
    y1: player.y,
    dashing: false,
  }

  if (player.dashT > 0) {
    const speed = dashDistance(fight.w) / config.dash.durationSec
    const step = Math.min(dt, player.dashT)
    player.x += player.dashDirX * speed * step
    player.y += player.dashDirY * speed * step
    player.dashT -= step
    clampPlayer(fight)
    fight.sweep = {
      x0: fight.sweep.x0,
      y0: fight.sweep.y0,
      x1: player.x,
      y1: player.y,
      dashing: true,
    }
    if (player.dashT <= 1e-8) {
      player.dashT = 0
      fight.dashEnded = true
    }
    return
  }

  if (input.dragging) {
    let dx = input.dragX
    let dy = input.dragY
    const len = Math.hypot(dx, dy)
    const cap = maxSpeed(fight.w) * dt
    if (len > cap && len > 0) {
      dx *= cap / len
      dy *= cap / len
    }
    player.x += dx
    player.y += dy
    clampPlayer(fight)
    fight.sweep = {
      x0: fight.sweep.x0,
      y0: fight.sweep.y0,
      x1: player.x,
      y1: player.y,
      dashing: false,
    }
  }
}

function beginDash(fight: Fight, dirX: number, dirY: number, result: StepResult): void {
  const len = Math.hypot(dirX, dirY) || 1
  const player = fight.player
  player.dashDirX = dirX / len
  player.dashDirY = dirY / len
  player.dashT = config.dash.durationSec
  player.dashId += 1
  player.dashJustDodged = false
  player.dashesStarted += 1
  result.dashed = true
}

function finishDash(fight: Fight): void {
  if (!fight.dashEnded) return
  fight.dashEnded = false
  if (!fight.player.dashJustDodged) {
    fight.player.dashCooldown = config.dash.cooldownSec
  }
}

function resolveHits(fight: Fight, result: StepResult): void {
  const radius = hitboxRadius(fight.w)
  const sweep = fight.sweep
  for (const hazard of fight.attacks) {
    const touching = overlaps(hazard, sweep, radius)
    const grazing = !touching && tutorialFlickGraze(fight, hazard, sweep)
    if (!touching && !grazing) continue
    if (sweep.dashing) {
      if (hazard.justDodgeDashId !== fight.player.dashId) {
        hazard.justDodgeDashId = fight.player.dashId
        grantJustDodge(fight)
        result.justDodge = true
      }
      continue
    }
    if (hazard.didHit || fight.player.hitInvuln > 0) continue
    hazard.didHit = true
    hazard.frozenT = config.hit.freezeSec
    hazard.whiteT = config.hit.freezeSec
    fight.player.hp -= 1
    fight.player.hits += 1
    fight.player.hitInvuln = config.player.hitInvulnSec
    fight.shakeT = Math.max(fight.shakeT, config.justDodge.shakeSec * 0.7)
    result.hit = true
    if (fight.player.hp <= 0) {
      fight.player.hp = 0
      fight.mode = 'dead'
      result.died = true
      return
    }
  }
}

/** A late sideways flick past an aimed tutorial shot, before the circles meet. */
function tutorialFlickGraze(fight: Fight, hazard: Hazard, sweep: Sweep): boolean {
  if (!sweep.dashing || !fight.onboarding || fight.onboardingDone) return false
  if (hazard.type !== 'bullet' || hazard.kind !== 'straight') return false
  const graze = config.onboarding.flickGrazeWidths * fight.w
  return pointSegmentDistance(sweep.x0, sweep.y0, hazard.px, hazard.py, hazard.x, hazard.y) <= graze
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const ab2 = abx * abx + aby * aby
  const t = ab2 <= 1e-12 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2))
  const dx = ax + abx * t - px
  const dy = ay + aby * t - py
  return Math.hypot(dx, dy)
}

function overlaps(hazard: Hazard, sweep: Sweep, radius: number): boolean {
  if (hazard.type === 'laser') {
    return rangesMeet(
      sweep.x0,
      sweep.x1,
      hazard.px,
      hazard.x,
      radius + hazard.width / 2,
    )
  }
  return segmentsClose(
    sweep.x0,
    sweep.y0,
    sweep.x1,
    sweep.y1,
    hazard.px,
    hazard.py,
    hazard.x,
    hazard.y,
    radius + hazard.r,
  )
}

function rangesMeet(a0: number, a1: number, b0: number, b1: number, rad: number): boolean {
  const d0 = a0 - b0
  const d1 = a1 - b1
  if (Math.abs(d0) <= rad || Math.abs(d1) <= rad) return true
  return (d0 > 0 && d1 < 0) || (d0 < 0 && d1 > 0)
}

function segmentsClose(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  q0x: number,
  q0y: number,
  q1x: number,
  q1y: number,
  rad: number,
): boolean {
  const ux = p1x - p0x
  const uy = p1y - p0y
  const vx = q1x - q0x
  const vy = q1y - q0y
  const wx = p0x - q0x
  const wy = p0y - q0y
  const a = ux * ux + uy * uy
  const c = vx * vx + vy * vy
  if (a <= 1e-12 && c <= 1e-12) {
    return wx * wx + wy * wy <= rad * rad
  }
  const b = ux * vx + uy * vy
  const d = ux * wx + uy * wy
  const e = vx * wx + vy * wy
  const denom = a * c - b * b
  let sN: number
  let sD = denom
  let tN: number
  let tD = denom
  if (denom < 1e-8) {
    sN = 0
    sD = 1
    tN = e
    tD = c
  } else {
    sN = b * e - c * d
    tN = a * e - b * d
    if (sN < 0) {
      sN = 0
      tN = e
      tD = c
    } else if (sN > sD) {
      sN = sD
      tN = e + b
      tD = c
    }
  }
  if (tN < 0) {
    tN = 0
    if (-d < 0) sN = 0
    else if (-d > a) sN = sD
    else {
      sN = -d
      sD = a
    }
  } else if (tN > tD) {
    tN = tD
    if (-d + b < 0) sN = 0
    else if (-d + b > a) sN = sD
    else {
      sN = -d + b
      sD = a
    }
  }
  const sc = Math.abs(sN) < 1e-8 || Math.abs(sD) < 1e-8 ? 0 : sN / sD
  const tc = Math.abs(tN) < 1e-8 || Math.abs(tD) < 1e-8 ? 0 : tN / tD
  const dx = wx + sc * ux - tc * vx
  const dy = wy + sc * uy - tc * vy
  return dx * dx + dy * dy <= rad * rad
}

function clampPlayer(fight: Fight): void {
  const radius = hitboxRadius(fight.w)
  const player = fight.player
  const minX = radius
  const maxX = fight.w - radius
  const minY = fight.h * config.player.playTopFraction
  const maxY = fight.h * config.player.playBottomFraction
  player.x = Math.max(minX, Math.min(maxX, player.x))
  player.y = Math.max(minY, Math.min(maxY, player.y))
}

function decayLocks(fight: Fight, dt: number): void {
  for (const hazard of fight.attacks) {
    if (hazard.frozenT !== undefined && hazard.frozenT > 0) {
      hazard.frozenT = Math.max(0, hazard.frozenT - dt)
    }
    if (hazard.whiteT !== undefined && hazard.whiteT > 0) {
      hazard.whiteT = Math.max(0, hazard.whiteT - dt)
    }
  }
}

function decayJuice(fight: Fight, dt: number): void {
  if (fight.shakeT > 0) fight.shakeT = Math.max(0, fight.shakeT - dt)
  if (fight.flashT > 0) fight.flashT = Math.max(0, fight.flashT - dt)
  if (fight.barPulse > 0) fight.barPulse = Math.max(0, fight.barPulse - dt)
}

/**
 * Real-time damage clock. Slow-mo still deals base DPS, so a just dodge's
 * 0.3s windup does not stretch the clear time. Boost DPS starts when slow-mo ends.
 */
function applyDamage(fight: Fight, realDt: number): boolean {
  const previousTime = fight.time
  let left = realDt
  while (left > 1e-12 && fight.mode === 'play') {
    let rate: number = config.player.dps
    let slice = left
    let segment: 'slow' | 'boost' | 'base' = 'base'
    if (fight.slowT > 0) {
      segment = 'slow'
      slice = Math.min(slice, fight.slowT)
    } else if (fight.boostT > 0) {
      segment = 'boost'
      slice = Math.min(slice, fight.boostT)
      rate = config.player.boostedDps
    }
    const used = Math.min(slice, fight.bossHp / rate)
    fight.bossHp -= rate * used
    fight.time += used
    left -= used
    if (fight.bossHp <= 1e-6) {
      fight.bossHp = 0
      fight.mode = 'clear'
      return true
    }
    if (segment === 'slow') {
      fight.slowT -= used
      if (fight.slowT <= 1e-9) {
        fight.slowT = 0
        if (fight.pendingBoost) {
          fight.boostT = config.justDodge.boostSec
          fight.pendingBoost = false
        }
      }
    } else if (segment === 'boost') {
      fight.boostT -= used
      if (fight.boostT <= 1e-9) fight.boostT = 0
    } else {
      left = 0
    }
  }
  if (fight.mode === 'play' && applyCalmChunks(fight, previousTime)) return true
  return false
}

/** Calm-phase beats on top of auto-fire, so the boss bar steps down in view. */
function applyCalmChunks(fight: Fight, previousTime: number): boolean {
  if (!fight.onboarding || fight.onboardingDone) return false
  const interval = config.onboarding.calmChunkIntervalSec
  const end = config.onboarding.calmSec
  if (previousTime >= end || interval <= 0) return false
  const prevN = Math.floor(Math.min(previousTime, end) / interval)
  const nowN = Math.floor(Math.min(fight.time, end) / interval)
  for (let n = prevN + 1; n <= nowN; n++) {
    const at = n * interval
    if (at <= 0 || at > end + 1e-9) continue
    fight.bossHp = Math.max(0, fight.bossHp - config.onboarding.calmChunkHp)
    fight.calmChunks += 1
    fight.barPulse = config.onboarding.barGlowPulseSec
    if (fight.bossHp <= 1e-6) {
      fight.bossHp = 0
      fight.mode = 'clear'
      return true
    }
  }
  return false
}

function mergeResult(a: StepResult, b: StepResult): StepResult {
  return {
    started: a.started || b.started,
    retried: a.retried || b.retried,
    dashed: a.dashed || b.dashed,
    justDodge: a.justDodge || b.justDodge,
    hit: a.hit || b.hit,
    died: a.died || b.died,
    cleared: a.cleared || b.cleared,
    fired: b.fired ?? a.fired,
  }
}

export function currentGap(fight: Fight): number {
  return gapSeconds(fight.bossHp, fight.bossMaxHp)
}
