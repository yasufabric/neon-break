# Neon Break

Portrait phone boss fight. Drag to move, release a flick to dash, and overlap an attack during that dash to just-dodge.

## Rules

Tunable numbers live in `src/game/config.ts`. The sim in `src/game/` is headless and is what `npm test` covers.

- Ship speed caps at 1.2 screen-widths per second. A flick is decided only on finger release.
- Dash is 0.25 widths over 0.15s and is invincible the whole way. A dash that does not just-dodge waits 1.0s. A just dodge clears that wait.
- Just dodge plays 0.3s of slow-motion, then 3s at 30 DPS (base DPS is 10). Boss HP is 1100, so a perfect-hit fight is 110s / 80s / 50s at 0 / 5 / 10 non-overlapping just dodges.
- Boss telegraphs for 0.6s. Gap is 1.2s, or 0.8s under half HP when two attack types fire together.
- Three hits end the run, with 1s of invincibility after each hit. One tap retries.
- S is a clear in 55s or less with zero hits. A is any other clear in 75s or less. B is any other clear.

## Checks

```bash
npm test
npm run build
```

Playtest at about 390×844. `window.__NEON__.frameMs` is the recent frame times and `quality` drops bloom when frames stay slow.
