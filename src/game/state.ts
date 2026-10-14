import type {
  Hazard,
  Mode,
  Phase,
  PlayerState,
  Sweep,
  Telegraph,
} from './types'

export interface Fight {
  w: number
  h: number
  mode: Mode
  time: number
  bossHp: number
  bossMaxHp: number
  attacksEnabled: boolean
  player: PlayerState
  attacks: Hazard[]
  telegraph: Telegraph | null
  gapRemaining: number
  patternIndex: number
  phase: Phase
  laserFromLeft: boolean
  nextId: number
  justDodges: number
  slowT: number
  boostT: number
  pendingBoost: boolean
  shakeT: number
  hitStopT: number
  flashT: number
  sweep: Sweep
  dashEnded: boolean
  onboarding: boolean
  onboardingDone: boolean
  tutorialSlot: number
  tutorialLaserArmed: boolean
  tutorialLasersFired: number
  tutorialShotsFired: number
  barPulse: number
  calmChunks: number
}
