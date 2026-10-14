const KEY = 'neon-break-best'
const ONBOARDING_KEY = 'neon-break-onboarded'

export interface KeyValue {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface Save {
  bestTime: number | null
  bestJust: number
  muted: boolean
}

export function emptySave(): Save {
  return { bestTime: null, bestJust: 0, muted: false }
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptySave()
    const parsed = JSON.parse(raw) as Partial<Save>
    return {
      bestTime: typeof parsed.bestTime === 'number' ? parsed.bestTime : null,
      bestJust: typeof parsed.bestJust === 'number' ? parsed.bestJust : 0,
      muted: parsed.muted === true,
    }
  } catch {
    return emptySave()
  }
}

export function writeSave(save: Save): void {
  localStorage.setItem(KEY, JSON.stringify(save))
}

export function readOnboardingDone(storage: KeyValue): boolean {
  return storage.getItem(ONBOARDING_KEY) === '1'
}

export function writeOnboardingDone(storage: KeyValue): void {
  storage.setItem(ONBOARDING_KEY, '1')
}

export function recordRun(save: Save, time: number, justDodges: number, cleared: boolean): Save {
  const bestJust = Math.max(save.bestJust, justDodges)
  const bestTime =
    cleared && (save.bestTime === null || time < save.bestTime) ? time : save.bestTime
  return { ...save, bestJust, bestTime }
}
