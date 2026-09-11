# Persistent local service

Fractal can run as a per-user macOS service at `http://127.0.0.1:5199`. The installed studio is a
production artifact under `~/Library/Application Support/Fractal`, so changing or removing the
development checkout does not change the running application. Project model files stay in their
own repositories and are read through the configured catalog.

## Install and update

Run this from a Fractal checkout:

```sh
bin/fractal service install
```

Install builds Fractal, prepares and validates a complete release, checks that the requested port
is available, then switches the LaunchAgent to the new release. Build, dependency-install, and
validation failures leave an existing service untouched. The LaunchAgent uses the absolute Node
executable that performed the install, binds the app to `127.0.0.1`, starts at login, and restarts
after an unexpected exit.

The installed artifact contains the server build, example models, production dependencies, and
the Playwright runtime used by PNG export. It never links `node_modules` or application code back
to the checkout. Runtime dependency versions come from the checked-in lockfile, including package
overrides. Run `npm ci` after dependency changes so the build and staged runtime use that same
tree. Playwright's Chromium browser must also be available to the installing user for PNG export.

Use another catalog, port, or installation root when needed:

```sh
bin/fractal service install --catalog ~/.config/fractal/catalog.json --port 5199
bin/fractal service install --runtime-dir "/custom/Fractal runtime"
```

`--catalog` takes precedence over `FRACTAL_CATALOG`. Otherwise the default is
`$XDG_CONFIG_HOME/fractal/catalog.json` when `XDG_CONFIG_HOME` is set, or
`~/.config/fractal/catalog.json`. Empty environment values fall back to the default. The catalog
remains outside the installed runtime and is not removed by uninstall.

## Inspect and operate

```sh
bin/fractal service status
bin/fractal service restart
bin/fractal service logs
bin/fractal service logs --lines 250
bin/fractal service uninstall
```

`status` checks all three parts of the running identity: the expected per-user LaunchAgent, the
process that owns the configured port, and an HTTP response from Fractal. It reports `running`,
`degraded`, or `stopped`; a process occupying the port is identified and is never killed.

Every command accepts `--json` for automation. Errors use a stable envelope:

```json
{
  "ok": false,
  "error": {
    "code": "port_occupied",
    "message": "Port 5199 is already owned by another process",
    "details": {
      "port": 5199,
      "owner": { "pid": 1234, "command": "another-server" }
    }
  }
}
```

`uninstall` unloads only Fractal's own LaunchAgent (`local.fractal.studio`, or the label in
`FRACTAL_SERVICE_LABEL`), removes its LaunchAgent file, and removes the application-owned installed
runtime. It does not touch project catalogs, model sources,
development servers, or tmux. Install and uninstall refuse a non-empty runtime directory unless it
contains Fractal's ownership record.

## Reach the studio from other machines

The service binds to loopback only. To open it from another device on the same Tailscale
network, publish it through `tailscale serve`:

```sh
bin/fractal service expose                   # https://<host>.<tailnet>.ts.net:5199/
bin/fractal service expose --https-port 443  # https://<host>.<tailnet>.ts.net/
bin/fractal service unexpose [--https-port PORT]
```

`expose` adds a tailnet-only HTTPS listener that proxies to the service port and confirms the
studio answers through it. The default HTTPS port is the service port, so the tailnet URL differs
from the local one only by host. The mapping is written to tailscaled's own state, so it survives
reboots and does not depend on any shell or tmux session; the service itself is kept alive by
launchd. `status` lists the current tailnet URLs, and `install` never changes them.

Listeners are identified by what they proxy to. `unexpose` removes only a listener that points at
Fractal's port and refuses one that belongs to another application. `expose` fails with
`serve_port_occupied` when a `tailscale serve` started without `--bg` is holding the port: that
kind of listener lives only as long as its process, is invisible to `tailscale serve status`, and
returns 502 once its backend is gone. The error names the process; stop it and run `expose` again.
Funnel (public internet) is deliberately not offered here.

The LaunchAgent label is a singleton for the user. Service commands pin it to the requested runtime
directory and refuse a mismatch; changing `--runtime-dir` is not an automatic migration.
The default label is `local.fractal.studio`; set `FRACTAL_SERVICE_LABEL` for every service command
when managing a service installed under another label.

## Prove an installed studio

The browser suite has an opt-in variant that runs against an installed studio. Use a disposable
copy of the bundled examples and a dedicated catalog for proof; do not point mutation tests at
models you are actively editing.

```sh
FRACTAL_INSTALLED_PROOF=1 FRACTAL_TEST_URL=http://127.0.0.1:5199 \
  FRACTAL_PROOF_SEQUENCE_SOURCE=/absolute/path/to/disposable/delivery/sequences.json \
  FRACTAL_PROOF_COMPANION_SOURCE=/absolute/path/to/disposable/fractal/fractal.json \
  npm run test:browser
```

The proof catalog must register the `delivery` and `fractal` models from those same disposable
directories. Without the companion override, the architecture proof temporarily edits the
checkout’s `docs/diagrams/fractal/fractal.json`. The sequence proof edits
and restores the named `sequences.json`; it is skipped when that variable is unset. Ordinary
`npm run test:browser` manages its own development server with bundled examples.
