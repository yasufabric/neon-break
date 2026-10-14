export type AttackKind = 'straight' | 'laser' | 'missile'

export type Mode = 'ready' | 'play' | 'dead' | 'clear'

export type Phase = 1 | 2

export interface FrameInput {
  dragging: boolean
  dragX: number
  dragY: number
  released: boolean
  releaseSpeed: number
  releaseDirX: number
  releaseDirY: number
  tap: boolean
}

export interface Sweep {
  x0: number
  y0: number
  x1: number
  y1: number
  dashing: boolean
}

export interface PlayerState {
  x: number
  y: number
  hp: number
  hits: number
  hitInvuln: number
  dashT: number
  dashCooldown: number
  dashDirX: number
  dashDirY: number
  dashId: number
  dashJustDodged: boolean
  dashesStarted: number
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
  justDodgeDashId: number
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
  t: number
  duration: number
  justDodgeDashId: number
  didHit: boolean
  frozenT?: number
  whiteT?: number
}

export type Hazard = BulletHazard | LaserHazard

export interface StepResult {
  started: boolean
  retried: boolean
  dashed: boolean
  justDodge: boolean
  hit: boolean
  died: boolean
  cleared: boolean
  fired: AttackKind[] | null
}
