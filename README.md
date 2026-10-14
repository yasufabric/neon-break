# ネオンブレイク / Neon Break

A portrait one-thumb boss fight for the mobile browser.

Drag to slide the ship (it will not teleport, and it caps at 1.2 screen-widths per second). Let go of a fast flick to dash. If a bullet, laser, or missile overlaps the ship during that dash, it is a just dodge: a short slow-motion hit, then three seconds of triple damage.

The boss hangs at the top of a neon street. Straight shots, a beam that sweeps across the screen, and homing missiles each glow for 0.6s before they fire. Under half health it mixes two of those at once. Three hits end the run. Tap to go again. The result is your time, your just dodges, and a rank: S, A, or B.

```bash
npm install
npm test
npm run dev
```

GitHub Pages serves the production build from `/neon-break/`.
