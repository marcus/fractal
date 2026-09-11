# Security

Fractal is a local studio that reads model files from your filesystem. It has no authentication.
Keep it bound to `127.0.0.1`. Share access only with trusted readers through a private network;
the [local service guide](docs/guides/active/local-service.md) describes optional Tailscale access.

Review models and catalog paths before opening files from an untrusted source. Do not put secrets
in model descriptions or evidence links: the studio and exports make that content readable.

Report a suspected vulnerability through [GitHub private vulnerability reporting](https://github.com/marcus/fractal/security/advisories/new).
Include a minimal reproduction and affected version, without private model data or credentials.
The project is experimental; security fixes target the latest revision of `main`.
