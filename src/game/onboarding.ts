import { config } from './config'

export type OnboardingPhase = 'calm' | 'straight' | 'laser' | 'live'

/** Real-time phase of a first-run clock. `live` is the normal fight. */
export function onboardingPhase(time: number): OnboardingPhase {
  if (time < config.onboarding.calmSec) return 'calm'
  if (time < config.onboarding.straightSec) return 'straight'
  if (time < config.onboarding.laserSec) return 'laser'
  return 'live'
}

/** Telegraph start times for the aimed tutorial shots. */
export function tutorialStraightStarts(): number[] {
  const starts: number[] = []
  const { calmSec, straightSec, straightIntervalSec } = config.onboarding
  for (let t = calmSec; t < straightSec - 1e-9; t += straightIntervalSec) {
    starts.push(t)
  }
  return starts
}
