import { config, projectileSpeed } from './config'
import { onboardingPhase } from './onboarding'
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

/** Homing missiles exist only once the boss is under half HP. */
export function missileAllowed(bossHp: number, bossMaxHp: number): boolean {
  return bossHp / bossMaxHp < config.boss.enrageHpFraction
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
  for (let i = 0; i < list.length; i++) {
    const index = fight.patternIndex % list.length
    const raw = list[index]
    fight.patternIndex += 1
    if (!raw) continue
    const kinds = raw.filter(
      (kind) => kind !== 'missile' || missileAllowed(fight.bossHp, fight.bossMaxHp),
    )
    if (kinds.length === 0) continue
    fight.telegraph = {
      kinds: [...kinds],
      remaining: config.boss.telegraphSec,
    }
    return
  }
}

export function updateSchedule(fight: Fight, worldDt: number): AttackKind[] | null {
  if (!fight.attacksEnabled || worldDt <= 0) return null
  if (fight.onboarding && !fight.onboardingDone) return updateTutorial(fight, worldDt)
  return updateNormal(fight, worldDt)
}

function updateNormal(fight: Fight, worldDt: number): AttackKind[] | null {
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

function updateTutorial(fight: Fight, worldDt: number): AttackKind[] | null {
  const phase = onboardingPhase(fight.time)
  switch (phase) {
    case 'calm':
      fight.telegraph = null
      return null
    case 'straight':
      return updateStraightTutorial(fight, worldDt)
    case 'laser':
      return updateLaserTutorial(fight, worldDt)
    case 'live':
      fight.onboardingDone = true
      fight.telegraph = null
      fight.gapRemaining = 0
      return updateNormal(fight, worldDt)
    default: {
      const never: never = phase
      return never
    }
  }
}

function updateStraightTutorial(fight: Fight, worldDt: number): AttackKind[] | null {
  let left = worldDt
  let fired: AttackKind[] | null = null
  let spins = 0
  while (left > 1e-9 && spins++ < 8) {
    const line = fight.telegraph?.tutorial === 'line' ? fight.telegraph : null
    if (line) {
      if (line.remaining > left) {
        line.remaining -= left
        return fired
      }
      left -= line.remaining
      const aimX = line.aimX ?? fight.player.x
      const aimY = line.aimY ?? fight.player.y
      fight.telegraph = null
      spawnTutorialStraight(fight, aimX, aimY)
      fight.tutorialShotsFired += 1
      fired = ['straight']
      continue
    }
    const start =
      config.onboarding.calmSec + fight.tutorialSlot * config.onboarding.straightIntervalSec
    if (start >= config.onboarding.straightSec - 1e-9) return fired
    if (fight.time + 1e-8 < start) return fired
    fight.tutorialSlot += 1
    fight.telegraph = {
      kinds: ['straight'],
      remaining: config.boss.telegraphSec,
      tutorial: 'line',
      aimX: fight.player.x,
      aimY: fight.player.y,
    }
  }
  return fired
}

function updateLaserTutorial(fight: Fight, worldDt: number): AttackKind[] | null {
  if (fight.tutorialLasersFired > 0) return null
  if (!fight.tutorialLaserArmed) {
    fight.attacks = []
    fight.tutorialLaserArmed = true
    fight.telegraph = {
      kinds: ['laser'],
      remaining: config.boss.telegraphSec,
      tutorial: 'band',
      safeFromLeft: !fight.laserFromLeft,
    }
  }
  const band = fight.telegraph?.tutorial === 'band' ? fight.telegraph : null
  if (!band) return null
  if (band.remaining > worldDt) {
    band.remaining -= worldDt
    return null
  }
  fight.telegraph = null
  spawnLaser(fight)
  fight.tutorialLasersFired += 1
  return ['laser']
}

function spawnTutorialStraight(fight: Fight, aimX: number, aimY: number): void {
  const speed =
    projectileSpeed(fight.w, config.boss.straightSpeedWidthsPerSec) *
    config.onboarding.bulletSpeedScale
  const y = fight.h * config.boss.spawnYFraction
  const dy = aimY - y
  const len = Math.abs(dy) || 1
  const r = config.boss.straightRadiusWidths * fight.w
  fight.attacks.push({
    type: 'bullet',
    id: fight.nextId++,
    kind: 'straight',
    x: aimX,
    y,
    px: aimX,
    py: y,
    vx: 0,
    vy: (dy / len) * speed,
    r,
    homingT: 0,
    life: config.boss.bulletLifeSec,
    grazeCooldown: 0,
    didHit: false,
  })
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
      if (!missileAllowed(fight.bossHp, fight.bossMaxHp)) return
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
  const speed = projectileSpeed(fight.w, config.boss.straightSpeedWidthsPerSec)
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
      grazeCooldown: 0,
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
    y: fight.h * config.boss.laserCenterFraction,
    width,
    height: fight.h * config.boss.laserHeightFraction,
    t: 0,
    duration: config.boss.laserSweepSec,
    grazeCooldown: 0,
    didHit: false,
  }
  fight.attacks.push(laser)
}

function spawnMissiles(fight: Fight): void {
  const y = fight.h * config.boss.spawnYFraction
  const speed = projectileSpeed(fight.w, config.boss.missileSpeedWidthsPerSec)
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
      grazeCooldown: 0,
      didHit: false,
    }
    fight.attacks.push(missile)
  }
}

export function moveHazards(fight: Fight, worldDt: number): void {
  if (worldDt <= 0) return
  const next: Hazard[] = []
  for (const hazard of fight.attacks) {
    if ((hazard.frozenT ?? 0) > 0) {
      hazard.px = hazard.x
      if (hazard.type === 'bullet') hazard.py = hazard.y
      next.push(hazard)
      continue
    }
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
  const speed = projectileSpeed(fight.w, config.boss.missileSpeedWidthsPerSec)
  const desiredX = (dx / len) * speed
  const desiredY = (dy / len) * speed
  const blend = 1 - Math.exp(-config.boss.missileTurn * worldDt)
  missile.vx += (desiredX - missile.vx) * blend
  missile.vy += (desiredY - missile.vy) * blend
  missile.homingT -= worldDt
  if (missile.homingT <= 0) {
    const v = Math.hypot(missile.vx, missile.vy) || 1
    const boost = projectileSpeed(fight.w, config.boss.missileBoostSpeedWidthsPerSec)
    missile.vx = (missile.vx / v) * boost
    missile.vy = (missile.vy / v) * boost
    missile.homingT = 0
  }
}
