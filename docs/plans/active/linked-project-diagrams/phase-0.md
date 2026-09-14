# Linked diagrams: phase 0 evidence

Status: complete. Task: `td-b67c0a`.
The [controlling plan](../linked-project-diagrams.md) defines acceptance. This document records
contract decisions, evidence and the handoff to phase 1; it does not authorize later phases.

## Read in this order

1. [Contract reference](../../../guides/active/linked-project-contract.md): versioned authored
   links, qualified identity, resolved composition state and diagnostics, with executable examples.
2. [Baseline and integration evidence](phase-0-baseline.md): current measured performance,
   fingerprints, reproducible commands and inspected Sidecar/td/Recall call paths.
3. [Interactive visual proposal](proposal.html): project frames, collapse, Trust membership,
   a directed bridge and an unavailable target in the studio's visual language.

## Phase boundary

Phase 0 supplies a small transport-neutral contract library with executable tests and fictional
source fixtures. It does not wire `links.json` into the model loader, catalog, CLI, HTTP routes,
portable reader or live studio. Existing commands still have their current single-model behavior.
The visual proposal is an illustrative interaction specimen; it is not a working composition engine
or an exhaustive model of Sidecar, td or Recall.

The fixtures intentionally reuse local IDs between projects so a later implementation cannot pass
by assuming globally unique element names. Validation must distinguish malformed input from a
valid reference whose target is not loaded. Resolution and source identity verification belong in
phase 1; explicit UID provenance must come from the authoring adapter, never inferred from spelling.

The state contract uses the existing theme and layout-engine IDs once per composition. Local
project states contain semantic visibility/scope only. This preserves the layout plan's rule that
direction is a property of an engine, avoiding a second LR/TB vocabulary and conflicting overrides.
A normalized composition includes its root as the first project; authored scene defaults must be
resolved before producing that normalized state.

## Evidence and acceptance

| Phase 0 outcome                                         | Evidence                                                                   | Status   |
| ------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| Current baseline and geometry fingerprints              | Baseline report and reproducible benchmark outputs                         | Verified |
| Fictional host/plugin fixtures with local ID collisions | `tests/fixtures/linked-projects/`                                          | Verified |
| Links, identity, diagnostics and state contract tests   | `tests/composition-contracts.test.ts`                                      | Verified |
| Verified Sidecar → td bridge                            | tdmonitor creates `monitor.NewEmbeddedWithOptions`; target `td/monitor`    | Verified |
| Recall prerequisite                                     | Plugin protocol exists; repository-owned model absent at conventional path | Verified |
| Interactive proposal in Fractal's visual language       | `proposal.html`, browser proof                                             | Verified |
| Independent review and repository checks                | Recorded below on completion                                               | Verified |

## Phase 1 entry points

Use the contract parsers without duplicating their rules in handlers. Add authored identity-origin
records at the LikeC4 adapter, then snapshots containing parsed links and their content revision.
Replace eager catalog compilation with lightweight summaries and targeted validation. Prove root
startup with unopened links before claiming lazy resolution. Reuse per-model local layouts and
produce explicit frame transforms and bridge geometry; the visual proposal's coordinates are not
an algorithm to transplant into production.

Source-owned model work must use the corrected Sidecar → td monitor connection. Recall authoring
and Sidecar's Recall element remain separate repository-owned prerequisites. Fractal work must not
copy full sibling models into public fixtures or silently modify those repositories.

## Validation and review record

- `npm run check`: zero errors or warnings.
- `npm test`: all 141 tests passed; after adding explicit-null regression coverage, all 8 focused
  composition contract tests passed (the full run contained the first 7).
- `npm run build`: production and portable reader builds passed.
- The [visual proof record](README.md#visual-proof) covers desktop/mobile, all themes, Trust,
  collapse/reopen, exact endpoint preservation, keyboard and focus restoration. Root independently
  inspected desktop Grove and mobile Midnight screenshots; a mobile legend overlap was fixed.
- Independent reviewer `/root/phase0_review` reviewed contracts, fixtures, phase boundaries,
  Sidecar/td source semantics and desktop proof. Root also reviewed benchmark additions and found
  no application behavior changes. The baseline sample was aligned to `td-integration` / `embeds`;
  strict-null defaults are covered by a dedicated regression test.
- Markdown links, embedded JSON examples, contract examples and formatting passed verification.
- Required local studio reinstall completed; service reports healthy with matching process and
  a new release, and existing tailnet exposure was preserved. A read-only HTTP smoke loaded the
  Fractal model and rendered its overview successfully (6 nodes, 11 edges). Host paths, release
  locations and service details remain outside the repository.

Baseline latency values characterize the existing single-model implementation; linked composition
performance gates cannot pass until that implementation exists. The prototype's direction is ready
for the first production slice; user feedback on the visual remains welcome and is not implied by
engineering review.
