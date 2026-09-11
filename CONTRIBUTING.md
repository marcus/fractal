# Contributing to Fractal

Start with the [README](README.md) to run the studio. Fractal is early software: small bug fixes,
clear reproductions, model examples and usability feedback are welcome. Open an issue before a
large feature or model-format change so we can agree on the user journey and scope.

Keep model, projection, layout and export behavior in the shared core. CLI and browser should
use the same rules. See [AGENTS.md](AGENTS.md) for engineering conventions and [DESIGN.md](DESIGN.md)
for interaction and visual principles. Optional maintainer tools are not prerequisites for contributing.

Before submitting a pull request:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm run build
npm run test:browser
```

For UI changes, include a screenshot or short recording and check keyboard navigation, dark themes
and reduced motion. For model or export changes, validate the affected scenes and inspect the
rendered SVG or PNG. Add a focused regression test when fixing behavior. Run `npm run docs` if
CLI help changes, and format edited files with Prettier.

Use fictional examples or material you have permission to share. Keep personal catalogs, credentials,
client data and machine-specific configuration out of commits and issue attachments.

Describe the problem, resulting behavior and validation in the pull request. Contributions are
licensed under the project's [Apache 2.0 license](LICENSE).
