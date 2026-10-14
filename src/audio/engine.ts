import { config } from '../game/config'
import type { Fight } from '../game/fight'
import type { StepResult } from '../game/types'

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private music: GainNode | null = null
  private filter: BiquadFilterNode | null = null
  private started = false
  private muted = false
  private nextNote = 0
  private stepIndex = 0
  private intensity = 0
  private shotWait = 0
  private noiseBuffer: AudioBuffer | null = null

  get isMuted(): boolean {
    return this.muted
  }

  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext()
      const master = ctx.createGain()
      master.gain.value = this.muted ? 0 : config.audio.master
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 900
      const music = ctx.createGain()
      music.gain.value = config.audio.musicGain
      music.connect(filter)
      filter.connect(master)
      master.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
      this.music = music
      this.filter = filter
      this.nextNote = ctx.currentTime + 0.06
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    this.started = true
  }

  suspend(): void {
    if (this.started && this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
  }

  resume(): void {
    if (this.started && this.ctx && this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const now = ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(muted ? 0 : config.audio.master, now, 0.03)
  }

  update(fight: Fight, result: StepResult, dt: number): void {
    if (!this.started || !this.ctx) return
    this.intensity = 1 - fight.bossHp / fight.bossMaxHp
    if (this.filter) {
      const open = 700 + this.intensity * 5200
      this.filter.frequency.setTargetAtTime(open, this.ctx.currentTime, 0.08)
    }
    this.scheduleMusic()
    if (fight.mode === 'play') {
      this.shotWait -= dt
      if (this.shotWait <= 0) {
        this.blip(720 + this.intensity * 280, 0.03, fight.boostT > 0 ? 0.05 : 0.02)
        this.shotWait = config.render.muzzleSec
      }
    }
    if (result.dashed) this.noise(0.09, 1400, 0.08)
    if (result.justDodge) {
      this.blip(880, 0.08, 0.16)
      this.blip(1320, 0.12, 0.1)
      this.noise(0.16, 2400, 0.12)
    }
    if (result.hit) this.blip(90, 0.18, 0.22)
    if (result.fired?.includes('laser')) this.blip(180, 0.22, 0.1)
    if (result.fired?.includes('missile')) this.blip(240, 0.1, 0.08)
    if (result.cleared) this.fanfare(true)
    if (result.died) this.fanfare(false)
  }

  private scheduleMusic(): void {
    const ctx = this.ctx
    const bus = this.music
    if (!ctx || !bus) return
    const bpm = config.audio.baseBpm + (config.audio.maxBpm - config.audio.baseBpm) * this.intensity
    const sixteenth = 60 / bpm / 4
    const horizon = ctx.currentTime + config.audio.lookaheadSec
    const degrees = [0, 3, 7, 5, 10, 7, 3, 5]
    while (this.nextNote < horizon) {
      const step = this.stepIndex
      const when = this.nextNote
      if (step % 4 === 0) this.kick(when)
      if (step % 2 === 1) this.hat(when)
      if (step % 8 === 0) {
        const bass = 55 * (this.intensity > 0.55 ? 2 : 1)
        this.tone(when, bass, sixteenth * 3.2, 'sawtooth', bus, 0.14)
      }
      const degree = degrees[step % degrees.length] ?? 0
      const arp = 220 * 2 ** (degree / 12)
      this.tone(when, arp, sixteenth * 0.85, 'triangle', bus, 0.045 + this.intensity * 0.03)
      if (this.intensity > 0.45 && step % 2 === 0) {
        this.tone(when, arp * 2, sixteenth * 0.4, 'square', bus, 0.025)
      }
      this.nextNote += sixteenth
      this.stepIndex += 1
    }
  }

  private tone(
    when: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    dest: AudioNode,
    gain: number,
  ): void {
    const ctx = this.ctx
    if (!ctx) return
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, when)
    amp.gain.setValueAtTime(0.0001, when)
    amp.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), when + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    osc.connect(amp)
    amp.connect(dest)
    osc.start(when)
    osc.stop(when + dur + 0.02)
  }

  private blip(freq: number, dur: number, gain: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const when = ctx.currentTime
    this.tone(when, freq, dur, 'sine', master, gain * config.audio.sfxGain)
  }

  private kick(when: number): void {
    const ctx = this.ctx
    const bus = this.music
    if (!ctx || !bus) return
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, when)
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.12)
    amp.gain.setValueAtTime(0.22, when)
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.16)
    osc.connect(amp)
    amp.connect(bus)
    osc.start(when)
    osc.stop(when + 0.18)
  }

  private hat(when: number): void {
    this.noiseAt(when, 0.03, 1800, 0.035)
  }

  private noise(dur: number, freq: number, gain: number): void {
    const ctx = this.ctx
    if (!ctx) return
    this.noiseAt(ctx.currentTime, dur, freq, gain)
  }

  private noiseAt(when: number, dur: number, freq: number, gain: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    if (!this.noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 0.25)
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
      this.noiseBuffer = buffer
    }
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = freq
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(gain * config.audio.sfxGain, when)
    amp.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    src.connect(filter)
    filter.connect(amp)
    amp.connect(master)
    src.start(when)
    src.stop(when + dur + 0.01)
  }

  private fanfare(win: boolean): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const notes = win ? [523, 659, 784, 1046] : [196, 155, 98]
    notes.forEach((freq, index) => {
      this.tone(ctx.currentTime + index * 0.09, freq, 0.22, 'triangle', master, 0.12)
    })
  }
}
