# Skin Editor

A free, open-source 3D Minecraft skin editor for the web.

Built with Next.js 15, React 19, React Three Fiber, and Tailwind CSS v4.
Released under the MIT License.

## Status

**Phase 1 / Milestone 1 — Scaffold.** This is the initial project shell: a landing page at `/`, a placeholder rotating cube at `/editor`, and the full Phase 1 dependency tree wired up. Milestones M2–M8 add the player model, 2D paint surface, tools, layers, undo, templates, persistence, and export.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the landing page, or http://localhost:3000/editor for the rotating-cube placeholder.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run lint` | Run `next lint` |

## Requirements

- Node.js ≥ 20.9

## Documentation

- [docs/DESIGN.md](docs/DESIGN.md) — full design document
- [docs/COMPOUND.md](docs/COMPOUND.md) — Compound Engineering knowledge journal
- [docs/plans/](docs/plans/) — milestone plans

## License

MIT © 2026 Ryan Sareen. See [LICENSE](LICENSE).
