# Working in Fractal

Fractal is a local-first, explorable model of software, with presentation-quality output.
If a shared `project-standards` skill is installed in your environment, load it at the start of
work here; then follow pragmatic-engineering, surface-parity, and write-plans when they apply.

Before changing studio layout, typography, navigation, inspection, or exports, read
[DESIGN.md](DESIGN.md) for the product's visual and interaction design principles.

For model authoring, updates, presentation views, exports, and opening Fractal for a reader,
load the repository-owned [Fractal usage skill](skills/fractal/SKILL.md).

- TypeScript + SvelteKit. Core model, projection, layout and export are transport-neutral.
- LikeC4 is the initial authoring language, behind an adapter. Do not fork its grammar.
- Model identity is separate from hierarchy, visual state, and layout coordinates.
- Boundaries are memberships, not invented structural parents. A visual boundary is a claim, never an enforcement mechanism.
- Browser and CLI use the same core. Keep text, inputs and results inspectable.
- Do not mutate another project's source. Example models are authored descriptions with provenance.
- Measure node content before layout. Preserve containment and relationship provenance when collapsing.
- New UI functionality must include keyboard access where practical. Register shortcuts in `src/lib/core/shortcuts.ts`; its definitions drive dispatch and the shortcut sheet. Do not add scattered key bindings. Native controls, text entry, IME and modal focus retain their normal behavior.
- Keyboard navigation, reduced motion, clean SVG/PNG output, and real browser proof matter.
- Repository visibility and licensing are the maintainer's decisions; do not change them.
- If this checkout has a task tracker configured (for example td), track substantive work there and start a new context with `td usage --new-session -q`.
- For completion: `npm run check`, `npm test`, `npm run build`, and focused browser proof.
- Use an independent sub-agent for review of substantial model/layout changes; record who reviewed.
- After changing application code, reinstall an installed local studio with `bin/fractal service install` so it serves the latest build, and confirm with `bin/fractal service status --json`. Reinstall keeps any tailnet exposure (`bin/fractal service expose`) intact; see [the local service guide](docs/guides/active/local-service.md).
- Host-specific notes (service labels, tailnet exposure, catalog contents, task tracking, terminal sessions) live outside this repository.

Controlling plan: docs/plans/active/fractal.md.
