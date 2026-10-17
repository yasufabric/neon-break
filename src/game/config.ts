import type { AttackKind } from './types'

/**
 * Every tunable number for Neon Break.
 * W is the screen width in CSS pixels. Speeds written as widths-per-second
 * scale with the phone. Damage does not: boss HP at 10 DPS is the no-graze
 * clear. Each non-overlapping graze replaces 3s of 10 DPS with 30 DPS
 * (+60 damage, −6s). With HP 1500 that is 150s / 120s / 90s at 0 / 5 / 10 grazes.
 * A drag that keeps grazing clears nearer 60s; one that rarely does, nearer 120s.
 */
export const config = {
  reference: {
    width: 390,
    height: 844,
  },
  player: {
    spriteWidths: 0.16,
    /** Hitbox diameter divided by sprite size. The circle is the inner 30%. */
    hitboxFractionOfSprite: 0.3,
    /** The ship sits this many widths above the finger and matches it exactly. */
    hoverWidths: 0.12,
    hitPoints: 5,
    hitInvulnSec: 1,
    dps: 10,
    boostedDps: 30,
    spawnXFraction: 0.5,
    spawnYFraction: 0.78,
    playTopFraction: 0.46,
    playBottomFraction: 0.93,
  },
  graze: {
    /** An attack this many hitbox-radii from the ship center grazes if it does not hit. */
    radiusScale: 2.5,
    /** One attack cannot graze again until this real-time cooldown ends. */
    cooldownSec: 1,
  },
  justDodge: {
    slowMoSec: 0.3,
    slowMoScale: 0.35,
    boostSec: 3,
    shakeSec: 0.3,
    shakePx: 16,
    hitStopSec: 0.06,
    flashSec: 0.14,
  },
  boss: {
    hp: 1500,
    telegraphSec: 0.9,
    gapSec: 1.2,
    enragedGapSec: 0.8,
    enrageHpFraction: 0.5,
    spawnYFraction: 0.2,
    straightCount: 9,
    straightSpreadWidths: 0.9,
    straightSpeedWidthsPerSec: 0.7,
    /** Applied to straight shots and missiles. 75% of the previous projectile speeds. */
    projectileSpeedScale: 0.75,
    straightRadiusWidths: 0.036,
    laserWidthWidths: 0.11,
    /**
     * The beam is a horizontal band, not a full-height wall, so a drag can sit
     * under it. A full-height sweep could only be survived with a dash.
     */
    laserCenterFraction: 0.55,
    laserHeightFraction: 0.34,
    laserSweepSec: 1.4,
    missileCount: 2,
    missileSpeedWidthsPerSec: 0.46,
    missileBoostSpeedWidthsPerSec: 1.15,
    missileHomingSec: 0.85,
    missileRadiusWidths: 0.042,
    missileTurn: 7,
    missileLifeSec: 4.5,
    bulletLifeSec: 4,
    /** No missiles here. Homing missiles exist only under `enrageHpFraction`. */
    phase1: [['straight'], ['laser']] as readonly (readonly AttackKind[])[],
    phase2: [
      ['straight', 'missile'],
      ['laser', 'straight'],
      ['missile', 'laser'],
    ] as readonly (readonly AttackKind[])[],
  },
  rank: {
    sMaxClearSec: 75,
    sMaxHits: 0,
    aMaxClearSec: 120,
  },
  render: {
    maxDpr: 2,
    bloomResolutionScale: 0.5,
    bloomStrength: 0.72,
    bloomStrengthLow: 0.25,
    bloomRadius: 0.38,
    bloomThreshold: 0.32,
    muzzleSec: 0.11,
    slowFrameMs: 18,
    slowFrameCount: 40,
    maxParticlesHigh: 260,
    maxParticlesLow: 70,
    /** Glowing dot radius as a fraction of the hitbox radius. */
    hitboxDotFraction: 0.62,
    fov: 46,
    worldSpanX: 4.8,
    worldSpanY: 8.4,
    worldOriginY: -1.15,
  },
  audio: {
    lookaheadSec: 0.12,
    scheduleStepSec: 0.025,
    master: 0.32,
    baseBpm: 102,
    maxBpm: 128,
    musicGain: 0.55,
    sfxGain: 0.8,
  },
  sim: {
    maxFrameSec: 0.05,
  },
  clearSim: {
    firstTriggerSec: 0.5,
    /** Extra pad so a boost fully ends before the next scripted just dodge. */
    triggerSpacingPadSec: 0.25,
  },
  /**
   * First run only. Clock starts as soon as that run does, before the first touch.
   * 0–calmSec: no attacks. calmSec–straightSec: one aimed shot per interval.
   * straightSec–laserSec: one laser. After laserSec: the normal script.
   */
  onboarding: {
    calmSec: 4,
    straightSec: 12,
    laserSec: 20,
    straightIntervalSec: 2,
    bulletSpeedScale: 0.6,
    /** Extra HP removed on each calm beat so the boss bar steps down in view. */
    calmChunkIntervalSec: 1,
    calmChunkHp: 80,
    barGlowPulseSec: 0.45,
    fingerSwingHz: 0.45,
    fingerAmplitudeWidths: 0.22,
    fingerSizePx: 56,
    aimLinePx: 4,
    bandHeightFraction: 0.2,
    damageNumberPx: 22,
    damageNumberScale: 3,
    damageNumberLifeSec: 0.9,
    haloPx: 96,
  },
  bots: {
    sampleStepWidths: 0.08,
    maxStepWidths: 0.1,
    lookaheadSec: 0.45,
    safetyPx: 8,
    wanderHoldSec: 0.32,
    wanderWidthsPerSec: 0.85,
    randomSeed: 7,
  },
  hit: {
    /** The attack that landed holds still and flashes white for this long. */
    freezeSec: 0.2,
    shatterSec: 0.45,
  },
}

export function spriteSize(width: number): number {
  return width * config.player.spriteWidths
}

/** Radius of the circular hurtbox. Diameter is 30% of the sprite size. */
export function hitboxRadius(width: number): number {
  return (spriteSize(width) * config.player.hitboxFractionOfSprite) / 2
}

/** Radius inside which a near-miss grazes. Hitting still uses `hitboxRadius`. */
export function grazeRadius(width: number): number {
  return hitboxRadius(width) * config.graze.radiusScale
}

export function projectileSpeed(width: number, widthsPerSec: number): number {
  return widthsPerSec * config.boss.projectileSpeedScale * width
}

/**
 * Clear time at 100% hit rate when grazes do not overlap.
 * Slow-mo deals base DPS, so it does not add time on top of this.
 */
export function expectedClearSeconds(grazes: number): number {
  const extra =
    grazes * config.justDodge.boostSec * (config.player.boostedDps - config.player.dps)
  return (config.boss.hp - extra) / config.player.dps
}
