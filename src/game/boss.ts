import { config } from './config'
import type { Fight } from './state'
import type { AttackKind, BulletHazard, Hazard, LaserHazard, Phase } from './types'

export function gapSeconds(bossHp: number, bossMaxHp: number): number {
  return bossHp / bossMaxHp < config.boss.enrageHpFraction
    ? config.boss.enragedGapSec
    : config.boss.gapSec
}

export function phaseForHp(bossHp: number, bossMaxHp: number): Phase {
  return bossHp / bossMaxHp < config.boss.enrageHpFraction ? 2 : 1
}

function patternList(phase: Phase): readonly (readonly AttackKind[])[] {
  switch (phase) {
    case 1:
      return config.boss.phase1
    case 2:
      return config.boss.phase2
    default: {
      const never: never = phase
      return never
    }
  }
}

export function openTelegraph(fight: Fight): void {
  const phase = phaseForHp(fight.bossHp, fight.bossMaxHp)
  if (phase !== fight.phase) {
    fight.phase = phase
    fight.patternIndex = 0
  }
  const list = patternList(fight.phase)
  const index = fight.patternIndex % list.length
  const kinds = list[index]
  if (!kinds) return
  fight.patternIndex += 1
  fight.telegraph = {
    kinds: [...kinds],
    remaining: config.boss.telegraphSec,
  }
}

export function updateSchedule(fight: Fight, worldDt: number): AttackKind[] | null {
  if (!fight.attacksEnabled || worldDt <= 0) return null
  let left = worldDt
  let fired: AttackKind[] | null = null
  while (left > 1e-9) {
    if (fight.telegraph) {
      if (fight.telegraph.remaining - left > 1e-8) {
        fight.telegraph.remaining -= left
        return fired
      }
      left = Math.max(0, left - fight.telegraph.remaining)
      const kinds = fight.telegraph.kinds
      fight.telegraph = null
      for (const kind of kinds) spawn(fight, kind)
      fight.gapRemaining = gapSeconds(fight.bossHp, fight.bossMaxHp)
      fired = kinds
      continue
    }
    if (fight.gapRemaining - left > 1e-8) {
      fight.gapRemaining -= left
      return fired
    }
    left = Math.max(0, left - fight.gapRemaining)
    fight.gapRemaining = 0
    openTelegraph(fight)
  }
  return fired
}

function spawn(fight: Fight, kind: AttackKind): void {
  switch (kind) {
    case 'straight':
      spawnStraight(fight)
      return
    case 'laser':
      spawnLaser(fight)
      return
    case 'missile':
      spawnMissiles(fight)
      return
    default: {
      const never: never = kind
      return never
    }
  }
}

function spawnStraight(fight: Fight): void {
  const count = config.boss.straightCount
  const spread = config.boss.straightSpreadWidths * fight.w
  const step = count > 1 ? spread / (count - 1) : 0
  const origin = fight.player.x - spread / 2
  const speed = config.boss.straightSpeedWidthsPerSec * fight.w
  const y = fight.h * config.boss.spawnYFraction
  const r = config.boss.straightRadiusWidths * fight.w
  for (let i = 0; i < count; i++) {
    fight.attacks.push({
      type: 'bullet',
      id: fight.nextId++,
      kind: 'straight',
      x: origin + step * i,
      y,
      px: origin + step * i,
      py: y,
      vx: 0,
      vy: speed,
      r,
      homingT: 0,
      life: config.boss.bulletLifeSec,
      justDodgeDashId: 0,
      didHit: false,
    })
  }
}

function spawnLaser(fight: Fight): void {
  const width = config.boss.laserWidthWidths * fight.w
  const fromLeft = fight.laserFromLeft
  fight.laserFromLeft = !fight.laserFromLeft
  const x0 = fromLeft ? -width : fight.w + width
  const x1 = fromLeft ? fight.w + width : -width
  const laser: LaserHazard = {
    type: 'laser',
    id: fight.nextId++,
    kind: 'laser',
    x: x0,
    px: x0,
    x0,
    x1,
    y: fight.h * 0.5,
    width,
    t: 0,
    duration: config.boss.laserSweepSec,
    justDodgeDashId: 0,
    didHit: false,
  }
  fight.attacks.push(laser)
}

function spawnMissiles(fight: Fight): void {
  const y = fight.h * config.boss.spawnYFraction
  const speed = config.boss.missileSpeedWidthsPerSec * fight.w
  const r = config.boss.missileRadiusWidths * fight.w
  const count = config.boss.missileCount
  for (let i = 0; i < count; i++) {
    const x = fight.w * (count === 1 ? 0.5 : 0.22 + (0.56 * i) / (count - 1))
    const dx = fight.player.x - x
    const dy = fight.player.y - y
    const len = Math.hypot(dx, dy) || 1
    const missile: BulletHazard = {
      type: 'bullet',
      id: fight.nextId++,
      kind: 'missile',
      x,
      y,
      px: x,
      py: y,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      r,
      homingT: config.boss.missileHomingSec,
      life: config.boss.missileLifeSec,
      justDodgeDashId: 0,
      didHit: false,
    }
    fight.attacks.push(missile)
  }
}

export function moveHazards(fight: Fight, worldDt: number): void {
  if (worldDt <= 0) return
  const next: Hazard[] = []
  for (const hazard of fight.attacks) {
    if (hazard.type === 'laser') {
      hazard.px = hazard.x
      hazard.t += worldDt
      const u = Math.min(1, hazard.t / hazard.duration)
      hazard.x = hazard.x0 + (hazard.x1 - hazard.x0) * u
      if (hazard.t < hazard.duration + 0.05) next.push(hazard)
      continue
    }
    hazard.px = hazard.x
    hazard.py = hazard.y
    if (hazard.kind === 'missile' && hazard.homingT > 0) {
      steerMissile(fight, hazard, worldDt)
    }
    hazard.x += hazard.vx * worldDt
    hazard.y += hazard.vy * worldDt
    hazard.life -= worldDt
    const off =
      hazard.y > fight.h + hazard.r * 4 ||
      hazard.x < -fight.w ||
      hazard.x > fight.w * 2 ||
      hazard.life <= 0
    if (!off) next.push(hazard)
  }
  fight.attacks = next
}

function steerMissile(fight: Fight, missile: BulletHazard, worldDt: number): void {
  const dx = fight.player.x - missile.x
  const dy = fight.player.y - missile.y
  const len = Math.hypot(dx, dy) || 1
  const speed = config.boss.missileSpeedWidthsPerSec * fight.w
  const desiredX = (dx / len) * speed
  const desiredY = (dy / len) * speed
  const blend = 1 - Math.exp(-config.boss.missileTurn * worldDt)
  missile.vx += (desiredX - missile.vx) * blend
  missile.vy += (desiredY - missile.vy) * blend
  missile.homingT -= worldDt
  if (missile.homingT <= 0) {
    const v = Math.hypot(missile.vx, missile.vy) || 1
    const boost = config.boss.missileBoostSpeedWidthsPerSec * fight.w
    missile.vx = (missile.vx / v) * boost
    missile.vy = (missile.vy / v) * boost
    missile.homingT = 0
  }
}
