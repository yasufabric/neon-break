import { config, flickThreshold } from './config'

export interface PointerSample {
  x: number
  y: number
  t: number
}

export interface Flick {
  speed: number
  dirX: number
  dirY: number
  dash: boolean
}

/**
 * Finger speed across the last flick window. Called only on release so a
 * fast drag never dashes until the finger comes up.
 */
export function flickOnRelease(
  samples: readonly PointerSample[],
  upX: number,
  upY: number,
  upT: number,
  width: number,
): Flick {
  const windowSec = config.dash.flickWindowSec
  const t0 = upT - windowSec
  let ax = upX
  let ay = upY
  let haveAnchor = false
  for (const sample of samples) {
    if (sample.t <= t0) {
      ax = sample.x
      ay = sample.y
      haveAnchor = true
    } else {
      break
    }
  }
  if (!haveAnchor && samples.length > 0) {
    const first = samples[0]
    if (first) {
      ax = first.x
      ay = first.y
    }
  }
  const dx = upX - ax
  const dy = upY - ay
  const dist = Math.hypot(dx, dy)
  const speed = dist / windowSec
  const len = dist || 1
  return {
    speed,
    dirX: dx / len,
    dirY: dy / len,
    dash: speed > flickThreshold(width),
  }
}
