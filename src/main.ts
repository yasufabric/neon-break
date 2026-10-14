import { AudioEngine } from './audio/engine'
import { config } from './game/config'
import { createFight, stepFight, type Fight, type FrameInput } from './game/fight'
import { flickOnRelease, type PointerSample } from './game/input'
import { rankFor } from './game/rank'
import { loadSave, recordRun, writeSave, type Save } from './persist'
import { GameView } from './render/view'
import './style.css'

const canvasEl = document.querySelector<HTMLCanvasElement>('#view')
if (!canvasEl) throw new Error('missing canvas')
const canvas: HTMLCanvasElement = canvasEl

const flashEl = document.querySelector<HTMLElement>('#flash')
const bossFill = document.querySelector<HTMLElement>('#boss-fill')
const muteButton = document.querySelector<HTMLButtonElement>('#mute')
const pipsEl = document.querySelector<HTMLElement>('#pips')
const boostEl = document.querySelector<HTMLElement>('#boost')
const resultEl = document.querySelector<HTMLElement>('#result')
const rankEl = document.querySelector<HTMLElement>('#rank')
const timeEl = document.querySelector<HTMLElement>('#time')
const justEl = document.querySelector<HTMLElement>('#just')
const bestEl = document.querySelector<HTMLElement>('#best')

const view = new GameView(canvas)
const audio = new AudioEngine()
let save: Save = loadSave()
audio.setMuted(save.muted)
paintMute()

const fight: Fight = createFight({
  w: window.innerWidth,
  h: window.innerHeight,
})

const pips: HTMLElement[] = []
for (let i = 0; i < config.player.hitPoints; i++) {
  const pip = document.createElement('span')
  pipsEl?.append(pip)
  pips.push(pip)
}

let pointerId: number | null = null
let lastX = 0
let lastY = 0
let dragX = 0
let dragY = 0
let tap = false
let samples: PointerSample[] = []
let pendingFlick: { speed: number; dirX: number; dirY: number } | null = null
let settled = false
let lastNow = performance.now()

function toSim(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * fight.w,
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * fight.h,
  }
}

function onDown(event: PointerEvent): void {
  if (event.target === muteButton) return
  if (pointerId !== null) return
  audio.unlock()
  pointerId = event.pointerId
  canvas.setPointerCapture(event.pointerId)
  const point = toSim(event.clientX, event.clientY)
  lastX = point.x
  lastY = point.y
  const now = performance.now() / 1000
  samples = [{ x: point.x, y: point.y, t: now }]
  tap = true
}

function onMove(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return
  const point = toSim(event.clientX, event.clientY)
  dragX += point.x - lastX
  dragY += point.y - lastY
  lastX = point.x
  lastY = point.y
  const now = performance.now() / 1000
  samples.push({ x: point.x, y: point.y, t: now })
  const cutoff = now - 0.2
  while (samples.length > 2 && samples[0]!.t < cutoff) samples.shift()
}

function onUp(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return
  const point = toSim(event.clientX, event.clientY)
  dragX += point.x - lastX
  dragY += point.y - lastY
  const now = performance.now() / 1000
  const flick = flickOnRelease(samples, point.x, point.y, now, fight.w)
  if (flick.dash) pendingFlick = flick
  pointerId = null
  samples = []
}

canvas.addEventListener('pointerdown', onDown)
canvas.addEventListener('pointermove', onMove)
canvas.addEventListener('pointerup', onUp)
canvas.addEventListener('pointercancel', onUp)

muteButton?.addEventListener('pointerdown', (event) => {
  event.stopPropagation()
  event.preventDefault()
  audio.unlock()
  save = { ...save, muted: !save.muted }
  audio.setMuted(save.muted)
  writeSave(save)
  paintMute()
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend()
  else audio.resume()
  lastNow = performance.now()
})

function paintMute(): void {
  if (!muteButton) return
  muteButton.textContent = save.muted ? '×' : '♪'
  muteButton.setAttribute('aria-pressed', save.muted ? 'true' : 'false')
}

function consumeInput(): FrameInput {
  const input: FrameInput = {
    dragging: pointerId !== null || dragX !== 0 || dragY !== 0,
    dragX,
    dragY,
    released: pendingFlick !== null,
    releaseSpeed: pendingFlick?.speed ?? 0,
    releaseDirX: pendingFlick?.dirX ?? 1,
    releaseDirY: pendingFlick?.dirY ?? 0,
    tap,
  }
  dragX = 0
  dragY = 0
  tap = false
  pendingFlick = null
  return input
}

function resize(): void {
  const w = window.innerWidth
  const h = window.innerHeight
  const sx = w / fight.w
  const sy = h / fight.h
  fight.w = w
  fight.h = h
  fight.player.x *= sx
  fight.player.y *= sy
  for (const hazard of fight.attacks) {
    hazard.x *= sx
    hazard.px *= sx
    if (hazard.type === 'bullet') {
      hazard.y *= sy
      hazard.py *= sy
      hazard.vx *= sx
      hazard.vy *= sy
      hazard.r *= (sx + sy) * 0.5
    } else {
      hazard.x0 *= sx
      hazard.x1 *= sx
      hazard.width *= sx
    }
  }
  view.resize(w, h)
}

function paintHud(): void {
  if (bossFill) {
    const ratio = fight.bossHp / fight.bossMaxHp
    bossFill.style.transform = `scaleX(${Math.max(0, ratio)})`
    bossFill.classList.toggle('enraged', ratio < config.boss.enrageHpFraction)
  }
  pips.forEach((pip, index) => {
    pip.classList.toggle('on', index < fight.player.hp)
    pip.classList.toggle('hurt', fight.player.hitInvuln > 0)
  })
  if (boostEl) {
    const on = fight.boostT > 0
    boostEl.hidden = !on
    if (on) boostEl.style.transform = `scaleX(${fight.boostT / config.justDodge.boostSec})`
  }
  if (flashEl) flashEl.style.opacity = String(Math.min(0.85, fight.flashT / config.justDodge.flashSec))
  const ended = fight.mode === 'dead' || fight.mode === 'clear'
  if (resultEl) resultEl.hidden = !ended
  if (!ended) return
  const rank = rankFor(fight.mode === 'clear', fight.time, fight.player.hits)
  if (rankEl) {
    rankEl.textContent = rank ?? ''
    rankEl.dataset.rank = rank ?? ''
  }
  if (timeEl) timeEl.textContent = fight.time.toFixed(2)
  if (justEl) justEl.textContent = String(fight.justDodges)
  if (bestEl) {
    bestEl.textContent = save.bestTime === null ? '' : `BEST ${save.bestTime.toFixed(2)}`
  }
}

function frame(now: number): void {
  const rawMs = Math.max(0, now - lastNow)
  const dt = Math.min(config.sim.maxFrameSec, rawMs / 1000)
  lastNow = now
  if (!document.hidden) {
    const result = stepFight(fight, consumeInput(), dt)
    if ((fight.mode === 'dead' || fight.mode === 'clear') && !settled) {
      save = recordRun(save, fight.time, fight.justDodges, fight.mode === 'clear')
      writeSave(save)
      settled = true
    }
    if (fight.mode === 'play') settled = false
    audio.update(fight, result, dt)
    view.render(fight, result, dt, rawMs)
    paintHud()
  }
  const stats = {
    frameMs: view.frameMs.slice(-30),
    quality: view.quality,
  }
  window.__NEON__ = stats
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)

declare global {
  interface Window {
    __NEON__?: { frameMs: number[]; quality: string }
  }
}
