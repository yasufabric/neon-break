import { config, grazeRadius, hitboxRadius } from './config'
import { createFight, type Fight, type FrameInput, stepFight } from './fight'
import { rankFor, type Rank } from './rank'
import type { Hazard, Mode } from './types'

export interface BotReport {
  mode: Mode
  time: number
  hits: number
  justDodges: number
  rank: Rank | null
  bossHp: number
}

function shipInput(fight: Fight, x: number, y: number): FrameInput {
  return {
    dragging: true,
    fingerX: x,
    fingerY: y + config.player.hoverWidths * fight.w,
    tap: false,
  }
}

function clampShip(fight: Fight, x: number, y: number): { x: number; y: number } {
  const pad = hitboxRadius(fight.w)
  return {
    x: Math.max(pad, Math.min(fight.w - pad, x)),
    y: Math.max(
      fight.h * config.player.playTopFraction,
      Math.min(fight.h * config.player.playBottomFraction, y),
    ),
  }
}

function hazardSamples(hazard: Hazard, lookahead: number): { x: number; y: number }[] {
  if (hazard.type === 'laser') {
    const speed = (hazard.x1 - hazard.x0) / hazard.duration
    return [
      { x: hazard.x, y: hazard.y },
      { x: hazard.x + speed * lookahead, y: hazard.y },
    ]
  }
  return [
    { x: hazard.x, y: hazard.y },
    { x: hazard.x + hazard.vx * lookahead, y: hazard.y + hazard.vy * lookahead },
  ]
}

/** Positive means the point is outside the scaled hitbox of every attack. */
function slack(fight: Fight, x: number, y: number, scale: number): number {
  const radius = hitboxRadius(fight.w) * scale
  const lookahead = config.bots.lookaheadSec
  let best = 1e9
  for (const hazard of fight.attacks) {
    for (const sample of hazardSamples(hazard, lookahead)) {
      if (hazard.type === 'laser') {
        const yReach = radius + hazard.height / 2
        const yDist = Math.abs(y - sample.y)
        if (yDist > yReach) continue
        best = Math.min(best, Math.abs(x - sample.x) - (radius + hazard.width / 2))
        continue
      }
      best = Math.min(best, Math.hypot(x - sample.x, y - sample.y) - (radius + hazard.r))
    }
  }
  return best
}

function pathSlack(fight: Fight, x: number, y: number, scale: number): number {
  let worst = 1e9
  const steps = 6
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const px = fight.player.x + (x - fight.player.x) * t
    const py = fight.player.y + (y - fight.player.y) * t
    worst = Math.min(worst, slack(fight, px, py, scale))
  }
  return worst
}

function approach(fight: Fight, x: number, y: number): { x: number; y: number } {
  const maxStep = config.bots.maxStepWidths * fight.w
  const dx = x - fight.player.x
  const dy = y - fight.player.y
  const dist = Math.hypot(dx, dy)
  if (dist <= maxStep || dist <= 1e-6) return clampShip(fight, x, y)
  return clampShip(fight, fight.player.x + (dx / dist) * maxStep, fight.player.y + (dy / dist) * maxStep)
}

function laneY(fight: Fight): number {
  return fight.h * config.player.playBottomFraction - hitboxRadius(fight.w) - 2
}

function edgeX(fight: Fight, side: 'left' | 'right'): number {
  const pad = hitboxRadius(fight.w) + 6
  return side === 'left' ? pad : fight.w - pad
}

/** Clearance from bullet columns at the moment they reach `y`. Lasers in that row are fatal. */
function columnSlack(fight: Fight, x: number, y: number): number {
  const radius = grazeRadius(fight.w)
  let best = 1e9
  for (const hazard of fight.attacks) {
    if (hazard.type === 'laser') {
      const yReach = radius + hazard.height / 2
      if (Math.abs(y - hazard.y) <= yReach) best = Math.min(best, -1)
      continue
    }
    let futureX = hazard.x
    if (hazard.vy > 10 && hazard.y < y) {
      const t = (y - hazard.y) / hazard.vy
      futureX = hazard.x + hazard.vx * Math.max(0, t)
    }
    best = Math.min(best, Math.abs(x - futureX) - (radius + hazard.r))
  }
  return best
}

function noGrazeTarget(fight: Fight): { x: number; y: number } {
  const y = laneY(fight)
  const left = edgeX(fight, 'left')
  const right = edgeX(fight, 'right')
  const margin = grazeRadius(fight.w) + 18
  const incoming = fight.attacks.filter(
    (hazard) => hazard.type === 'bullet' && hazard.kind === 'straight' && hazard.y < y + 40,
  )
  if (fight.telegraph?.kinds.includes('straight')) {
    let camp = left
    if (incoming.length > 0) {
      const center =
        incoming.reduce((sum, hazard) => sum + hazard.x, 0) / incoming.length
      camp = center < fight.w / 2 ? left : right
    }
    if (pathSlack(fight, camp, y, 1) >= config.bots.safetyPx) return clampShip(fight, camp, y)
  }
  let xMin = left
  let xMax = right
  if (incoming.length > 0) {
    const minX = Math.min(...incoming.map((hazard) => hazard.x))
    const maxX = Math.max(...incoming.map((hazard) => hazard.x))
    const pockets = [
      { min: left, max: minX - margin },
      { min: maxX + margin, max: right },
    ].filter((pocket) => pocket.max - pocket.min > 12)
    const pocket = pockets.sort((a, b) => b.max - b.min - (a.max - a.min))[0]
    if (pocket) {
      xMin = pocket.min
      xMax = pocket.max
    }
  }
  let bestX = Math.max(xMin, Math.min(xMax, fight.player.x))
  let bestScore = -1e9
  const step = Math.max(8, (xMax - xMin) / 8)
  for (let x = xMin; x <= xMax + 0.1; x += step) {
    let missileGap = 1e9
    for (const hazard of fight.attacks) {
      if (hazard.type !== 'bullet' || hazard.kind !== 'missile') continue
      missileGap = Math.min(missileGap, Math.hypot(x - hazard.x, y - hazard.y) - hazard.r)
    }
    const blocked = pathSlack(fight, x, y, config.graze.radiusScale) < config.bots.safetyPx
    const score = missileGap - (blocked ? 500 : 0) - Math.abs(x - fight.player.x) * 0.01
    if (score > bestScore) {
      bestScore = score
      bestX = x
    }
  }
  const missiles = fight.attacks.some((hazard) => hazard.type === 'bullet' && hazard.kind === 'missile')
  if (incoming.length === 0 && !missiles) bestX = left
  return approach(fight, bestX, y)
}

function skimTarget(fight: Fight): { x: number; y: number } | null {
  const hit = hitboxRadius(fight.w)
  const graze = grazeRadius(fight.w)
  const y = laneY(fight)
  let choice: { x: number; y: number; score: number } | null = null
  for (const hazard of fight.attacks) {
    if (hazard.type !== 'bullet' || hazard.grazeCooldown > 0 || hazard.vy <= 0) continue
    const offset = (hit + graze) / 2 + hazard.r
    for (const sign of [1, -1]) {
      const point = clampShip(fight, hazard.x + sign * offset, y)
      if (columnSlack(fight, point.x, y) < -hazard.r) continue
      if (pathSlack(fight, point.x, point.y, 1) < config.bots.safetyPx) continue
      const approach = Math.max(0, y - hazard.y)
      const score = 2000 - approach
      if (!choice || score > choice.score) choice = { x: point.x, y: point.y, score }
    }
  }
  if (!choice) return null
  return approach(fight, choice.x, choice.y)
}

export function noGrazeInput(fight: Fight): FrameInput {
  const target = noGrazeTarget(fight)
  return shipInput(fight, target.x, target.y)
}

export function frequentGrazeInput(fight: Fight): FrameInput {
  if (fight.slowT > 0 || fight.boostT > 0) return noGrazeInput(fight)
  const skim = skimTarget(fight)
  if (!skim) return noGrazeInput(fight)
  return shipInput(fight, skim.x, skim.y)
}

export function createRandomDrag(seed = config.bots.randomSeed): (fight: Fight) => FrameInput {
  let state = seed >>> 0
  const rand = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  let hold = 0
  let targetX = config.reference.width * 0.5
  let targetY = config.reference.height * 0.78
  return (fight) => {
    hold -= 1 / 60
    if (hold <= 0) {
      hold = config.bots.wanderHoldSec
      const pad = hitboxRadius(fight.w)
      targetX = pad + rand() * (fight.w - pad * 2)
      const top = fight.h * config.player.playTopFraction
      const bottom = fight.h * config.player.playBottomFraction
      targetY = top + rand() * (bottom - top)
    }
    const speed = config.bots.wanderWidthsPerSec * fight.w
    const dx = targetX - fight.player.x
    const dy = targetY - fight.player.y
    const dist = Math.hypot(dx, dy)
    const step = Math.min(dist, speed / 60)
    const next =
      dist <= 1e-6
        ? { x: fight.player.x, y: fight.player.y }
        : { x: fight.player.x + (dx / dist) * step, y: fight.player.y + (dy / dist) * step }
    return shipInput(fight, next.x, next.y)
  }
}

function finish(fight: Fight): BotReport {
  return {
    mode: fight.mode,
    time: fight.time,
    hits: fight.player.hits,
    justDodges: fight.justDodges,
    rank: rankFor(fight.bossHp <= 0, fight.time, fight.player.hits),
    bossHp: fight.bossHp,
  }
}

function run(inputFor: (fight: Fight) => FrameInput, limitSec: number): BotReport {
  const fight = createFight({
    w: config.reference.width,
    h: config.reference.height,
    attacksEnabled: true,
  })
  fight.mode = 'play'
  const dt = 1 / 60
  let guard = 0
  const limit = limitSec * 60
  while (fight.mode === 'play') {
    if (guard++ > limit) break
    stepFight(fight, inputFor(fight), dt)
  }
  return finish(fight)
}

export function runNoGrazeBot(): BotReport {
  return run(noGrazeInput, 180)
}

export function runFrequentGrazeBot(): BotReport {
  return run(frequentGrazeInput, 180)
}

export function runRandomDragBot(): BotReport {
  return run(createRandomDrag(), 180)
}
