export type AttackKind = 'straight' | 'laser' | 'missile'

export type Mode = 'ready' | 'play' | 'dead' | 'clear'

export type Phase = 1 | 2

export interface FrameInput {
  dragging: boolean
  /** Sim-space finger position. The ship uses it only while dragging. */
  fingerX: number
  fingerY: number
  tap: boolean
}

export interface Sweep {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PlayerState {
  x: number
  y: number
  hp: number
  hits: number
  hitInvuln: number
}

export type TutorialCue = 'line' | 'band'

export interface Telegraph {
  kinds: AttackKind[]
  remaining: number
  tutorial?: TutorialCue
  aimX?: number
  aimY?: number
  /** When true, the left half of the tutorial band is the safe side. */
  safeFromLeft?: boolean
}

export interface BulletHazard {
  type: 'bullet'
  id: number
  kind: 'straight' | 'missile'
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  r: number
  homingT: number
  life: number
  grazeCooldown: number
  /** Set when this bullet grazes, until it leaves the graze radius. Blocks a hit on that pass. */
  grazePass: boolean
  didHit: boolean
  frozenT?: number
  whiteT?: number
}

export interface LaserHazard {
  type: 'laser'
  id: number
  kind: 'laser'
  x: number
  px: number
  x0: number
  x1: number
  y: number
  width: number
  height: number
  t: number
  duration: number
  grazeCooldown: number
  /** Set when this beam grazes, until it leaves the graze radius. Blocks a hit on that pass. */
  grazePass: boolean
  didHit: boolean
  frozenT?: number
  whiteT?: number
}

export type Hazard = BulletHazard | LaserHazard

export interface StepResult {
  started: boolean
  retried: boolean
  justDodge: boolean
  hit: boolean
  died: boolean
  cleared: boolean
  fired: AttackKind[] | null
}
