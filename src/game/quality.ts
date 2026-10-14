import { config } from './config'

export type Quality = 'high' | 'low' | 'off'

export interface QualityState {
  quality: Quality
  recent: number[]
}

export function nextQuality(state: QualityState, frameMs: number): QualityState {
  const recent = [...state.recent, frameMs].slice(-config.render.slowFrameCount)
  if (recent.length < config.render.slowFrameCount) {
    return { quality: state.quality, recent }
  }
  const hot = recent.filter((ms) => ms > config.render.slowFrameMs).length
  if (hot / recent.length < 0.75) return { quality: state.quality, recent }
  switch (state.quality) {
    case 'high':
      return { quality: 'low', recent: [] }
    case 'low':
      return { quality: 'off', recent: [] }
    case 'off':
      return { quality: 'off', recent: [] }
    default: {
      const never: never = state.quality
      return never
    }
  }
}

export function particleCap(quality: Quality): number {
  switch (quality) {
    case 'high':
      return config.render.maxParticlesHigh
    case 'low':
    case 'off':
      return config.render.maxParticlesLow
    default: {
      const never: never = quality
      return never
    }
  }
}
