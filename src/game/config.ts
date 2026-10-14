import type { AttackKind } from './types'

/**
 * Every tunable number for Neon Break.
 * W is the screen width in CSS pixels. Speeds written as widths-per-second
 * scale with the phone. Damage does not: boss HP 1100 at 10 DPS is 110s
 * when every shot hits and no just dodge fires. Each non-overlapping just
 * dodge replaces 3s of 10 DPS with 30 DPS (+60 damage, −6s).
 *   0 just dodges → 110s
 *   5 just dodges → 80s
 *   10 just dodges → 50s
 */
export const config = {
  reference: {
    width: 390,
    height: 844,
  },
  player: {
    maxSpeedWidthsPerSec: 1.2,
    spriteWidths: 0.16,
    /** Hitbox diameter divided by sprite size. The circle is the inner 30%. */
    hitboxFractionOfSprite: 0.3,
    hitPoints: 3,
    hitInvulnSec: 1,
    dps: 10,
    boostedDps: 30,
    spawnXFraction: 0.5,
    spawnYFraction: 0.78,
    playTopFraction: 0.46,
    playBottomFraction: 0.93,
  },
  dash: {
    distanceWidths: 0.25,
    durationSec: 0.15,
    /** After a dash that did not just-dodge. */
    cooldownSec: 1,
    /** Applied the instant a just dodge lands, so the next dash can chain. */
    justDodgeCooldownSec: 0,
    flickWindowSec: 0.06,
    /** Strictly greater than this, measured on finger release, starts a dash. */
    flickSpeedWidthsPerSec: 2.5,
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
    hp: 1100,
    telegraphSec: 0.6,
    gapSec: 1.2,
    enragedGapSec: 0.8,
    enrageHpFraction: 0.5,
    spawnYFraction: 0.2,
    straightCount: 9,
    straightSpreadWidths: 0.9,
    straightSpeedWidthsPerSec: 0.7,
    straightRadiusWidths: 0.036,
    laserWidthWidths: 0.11,
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
    sMaxClearSec: 55,
    sMaxHits: 0,
    aMaxClearSec: 75,
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
    /**
     * Center distance, in screen widths, inside which a sideways flick still
     * just-dodges an aimed tutorial shot. Wide enough for a late flick, short
     * of the whole approach.
     */
    flickGrazeWidths: 0.24,
    /** Extra HP removed on each calm beat so the boss bar steps down in view. */
    calmChunkIntervalSec: 1,
    calmChunkHp: 80,
    barGlowPulseSec: 0.45,
    fingerSwingHz: 0.7,
    fingerAmplitudeWidths: 0.16,
    fingerBelowShipFraction: 0.1,
    fingerSizePx: 56,
    aimLinePx: 4,
    bandHeightFraction: 0.2,
    damageNumberPx: 22,
    damageNumberScale: 3,
    damageNumberLifeSec: 0.9,
    haloPx: 96,
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

export function maxSpeed(width: number): number {
  return config.player.maxSpeedWidthsPerSec * width
}

export function flickThreshold(width: number): number {
  return config.dash.flickSpeedWidthsPerSec * width
}

export function dashDistance(width: number): number {
  return config.dash.distanceWidths * width
}

/**
 * Clear time at 100% hit rate when `justDodges` boosts do not overlap.
 * Slow-mo deals base DPS, so it does not add time on top of this.
 */
export function expectedClearSeconds(justDodges: number): number {
  const extra =
    justDodges *
    config.justDodge.boostSec *
    (config.player.boostedDps - config.player.dps)
  return (config.boss.hp - extra) / config.player.dps
}
