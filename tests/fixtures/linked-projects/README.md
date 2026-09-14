# Linked-project contract fixtures

Harbor (`host`) and Beacon (`plugin`) are fictional. Each owns its model, hierarchy, trust
membership, scenes and local relationship. They intentionally share `core`, `cli`, `store`,
`call`, `trust` and `overview` identities. Both own a different cross-project `call` claim.
The back-link forms a cycle for later resolver tests; these tests do not resolve it.
`missing-plugin` is deliberately absent, and is never claimed to be available.

Relay (`third`) is the fictional third plugin proving no host-specific renderer or registry
dependency. It reuses the same colliding local IDs (`core`, `cli`, `store`, `call`, `trust`,
`overview`), links back to `host` (into the host ↔ plugin cycle) and to `plugin` (so both
`host` and `third` target one `plugin` frame, the diamond reuse case), and owns a current
`call` claim plus a proposed `future` claim from its proposed `beta` element. `beta` is the
only proposed element in the fixtures; it is hidden whenever its project's view filters
proposed content.

`identity-origins.expected.json` is hand-authored expected adapter metadata, **not** current
adapter output or a supported model companion file. `core` has an explicit UID equal to its
LikeC4 source ID, whereas `core.fallback` has no UID. This proves spelling cannot establish
identity origin. Phase 1 must produce and validate this metadata at the adapter boundary.
The fictional evidence path is an inert claim pointer, not a claim a source file exists.
