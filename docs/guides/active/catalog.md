# Project catalog

The catalog maps model IDs to the repositories that own them. Fractal never copies a
model: entries point at project-owned directories, and the studio, CLI and exports all
resolve through the same file.

```json
{
  "version": 1,
  "projects": [
    {
      "id": "product",
      "directory": "/absolute/path/to/project/docs/diagrams/fractal"
    }
  ]
}
```

The entry ID must equal the `id` in that directory's `fractal.json`. Keep it stable when
a repository moves; update only the absolute directory. Duplicate IDs and broken catalog
JSON are fatal configuration errors — nothing loads until they are fixed. The same rule
holds for the other catalog kinds: in a `FRACTAL_MODELS_DIR` directory or the bundled
`examples/`, the directory name must equal its `fractal.json` `id`, and a mismatch is
invalid — a directory name never selects a model identity.

The default catalog is `~/.config/fractal/catalog.json` (or
`$XDG_CONFIG_HOME/fractal/catalog.json`). `--catalog PATH` overrides it for one command;
`FRACTAL_CATALOG` overrides the default file. The installed service may pin a catalog
explicitly — use the one its status reports. For a worktree preview or an unregistered
model, write a temporary catalog pointing at that directory rather than editing the real
one.

## Lightweight listing

`projects` answers from companion metadata only. It never compiles a model, so listing
stays fast no matter how large the catalog grows, and one bad entry cannot block the
healthy ones:

```sh
bin/fractal projects --catalog /path/to/catalog.json --json
```

```json
[
  {
    "id": "ghost",
    "title": "ghost",
    "description": "",
    "directory": "/nonexistent/dir",
    "diagnostic": "Model directory missing: /nonexistent/dir"
  },
  {
    "id": "product",
    "title": "Product",
    "description": "From a request to completed work.",
    "directory": "/absolute/path/to/project/docs/diagrams/fractal"
  }
]
```

An unavailable entry carries a `diagnostic` naming the problem; a healthy entry carries
its title and description. Full compilation happens only when a model is opened or
explicitly validated. The studio's project switcher reads the same listing, so it opens
with titles immediately; an unhealthy entry appears under its ID, and its diagnostic
surfaces when the project is selected and fails to load.

## Validating linked projects

```sh
bin/fractal validate --model harbor --catalog /path/to/catalog.json --json
bin/fractal validate --model harbor --catalog /path/to/catalog.json --linked --json
```

Plain validation compiles the model with its `links.json` and checks the file's structure,
ownership, evidence paths and duplicate IDs. Only `--linked` verifies that every `from`
and endpoint exists with an explicit `uid` and resolves the declared link closure —
including declared-but-unopened targets — exiting nonzero with structured diagnostics
for unresolved claims:

```json
{
  "valid": false,
  "model": "harbor",
  "diagnostics": [
    {
      "code": "model_unavailable",
      "ownerModel": "harbor",
      "message": "Unknown model: missing-plugin",
      "linkId": "unavailable",
      "target": { "model": "missing-plugin" },
      "recovery": "register"
    }
  ]
}
```

Validation is targeted: opening a root checks that root, opening a linked project checks
that project, and a malformed foreign model is found when its project opens or by
`--linked` — never by merely listing the catalog. Each diagnostic names its owner, the
failing claim and a recovery action (`register`, `retry`, `repair`, `upgrade`, `reload`
or `reduce`). See the [linked project contract](linked-project-contract.md) for the full
code table and the [linked-diagram usage](usage.md) for working with the result.
