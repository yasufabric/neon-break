# Neon Break

Portrait phone boss fight. Drag to move. The ship sits 0.12W above the finger and follows it exactly. An attack that passes inside 2.5 hitbox radii without hitting is a graze.

## Rules

Tunable numbers live in `src/game/config.ts`. The sim in `src/game/` is headless and is what `npm test` covers.

- Drag only. No dash, no flick, no speed cap, no smoothing.
- A graze plays 0.3s of slow-motion, then 3s at 30 DPS (base DPS is 10). The same attack cannot graze again for 1s.
- Boss HP is 1500, so a perfect-hit fight is 150s / 120s / 90s at 0 / 5 / 10 non-overlapping grazes. Simulated drag clears land around 60–120s.
- Boss telegraphs for 0.9s. Projectile speeds are 75% of the old values. The laser is a horizontal band you can drag under.
- Five hits end the run, with 1s of invincibility after each hit. One tap retries.
- S is a clear in 75s or less with zero hits. A is any other clear in 120s or less. B is any other clear.

## Checks

```bash
npm test
npm run build
```

Playtest at about 390×844. `window.__NEON__.frameMs` is the recent frame times and `quality` drops bloom when frames stay slow.
