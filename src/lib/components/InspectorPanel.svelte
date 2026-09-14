<script lang="ts">
  import InspectorShell from './InspectorShell.svelte';
  import InspectorContent from './InspectorContent.svelte';
  import InspectorDisclosure from './InspectorDisclosure.svelte';
  import { ChevronRight, ArrowUpRight, Maximize } from '@marcusv/roc/svelte/outline';
  import { inspectComponent } from '$lib/core/inspect';
  import { inspectConnection } from '$lib/composition/inspect';
  import type { Model, Diagram, ViewState } from '$lib/core/types';
  import type {
    ComposedDiagram,
    CompositionState,
    DiagramLink,
    ProjectLinks,
    QualifiedSelection
  } from '$lib/composition/types';
  interface AuthoredLinks {
    links: ProjectLinks | null;
    resolution: { model: string; status: string; message?: string }[];
  }
  let {
    model,
    diagram,
    selected,
    selectedType,
    view,
    composition = null,
    compositionSelection = null,
    links = null,
    toggle,
    focus,
    inspectElement,
    fullSystem,
    onopenlink,
    onshowproposed,
    onclose,
    onsettled
  }: {
    model: Model;
    diagram: Diagram | null;
    selected: string;
    selectedType: 'element' | 'relationship' | 'outside' | 'connection';
    view: ViewState;
    composition?: {
      state: CompositionState;
      composed: ComposedDiagram;
      models: Record<string, Model>;
      links?: Record<string, ProjectLinks | null>;
    } | null;
    compositionSelection?: QualifiedSelection | null;
    links?: AuthoredLinks | null;
    toggle: (id: string) => void;
    focus: (id: string) => void;
    inspectElement: (id: string) => void;
    fullSystem: () => void;
    onopenlink?: (link: DiagramLink) => void;
    onshowproposed?: (model: string) => void;
    onclose: () => void;
    onsettled: () => void;
  } = $props();
  const selectedElement = $derived(
    selectedType === 'element' ? model.elements.find((e) => e.id === selected) : undefined
  );
  const selectedEdge = $derived(
    selectedType === 'relationship' ? diagram?.edges.find((e) => e.id === selected) : undefined
  );
  const details = $derived(
    selectedElement ? inspectComponent(model, selectedElement.id, view) : null
  );
  const children = $derived(details?.children ?? []);
  const selectedBoundaries = $derived(details?.boundaries ?? []);
  const name = (id: string) => model.elements.find((e) => e.id === id)?.title ?? id;
  const connection = $derived(
    composition && compositionSelection?.kind === 'connection'
      ? inspectConnection(
          composition.composed,
          (id) => composition.models[id],
          {
            ownerModel: compositionSelection.ownerModel,
            connectionId: compositionSelection.connectionId
          },
          (id) => composition.links?.[id] ?? null
        )
      : null
  );
  const hiddenClaims = $derived.by(() => {
    if (!composition) return [];
    return composition.composed.hidden.filter((claim) => {
      const authored = composition.links?.[claim.owner]?.connections.find(
        (entry) => entry.id === claim.connectionId
      );
      if (!authored) return claim.owner === model.id;
      return (
        claim.owner === model.id ||
        authored.source.model === model.id ||
        authored.target.model === model.id
      );
    });
  });
  function projectName(id: string): string {
    return (
      composition?.models[id]?.title ??
      composition?.composed.projects.find((p) => p.model === id)?.title ??
      id
    );
  }
  function hiddenTitle(claim: (typeof hiddenClaims)[number]): string {
    return (
      composition?.links?.[claim.owner]?.connections.find(
        (entry) => entry.id === claim.connectionId
      )?.title ?? claim.connectionId
    );
  }
  /** True when this project's Proposed switch being off is what hides the endpoint. */
  function endpointHidesProposed(modelId: string, elementId: string): boolean {
    const entry = composition?.state.projects.find((project) => project.model === modelId);
    if (!entry || entry.view.proposed) return false;
    const elements = composition?.models[modelId]?.elements ?? [];
    let current = elements.find((element) => element.id === elementId);
    while (current) {
      if (current.status === 'proposed') return true;
      current = current.parent
        ? elements.find((element) => element.id === current!.parent)
        : undefined;
    }
    return false;
  }
  /**
   * The project whose Proposed switch would reveal this hidden claim. For a proposed-endpoint
   * claim that is the endpoint (source, then target) whose switch is off; never "the other
   * project from the one being inspected."
   */
  function showProposedTarget(
    claim: (typeof hiddenClaims)[number],
    authored:
      | { source: { model: string; element: string }; target: { model: string; element: string } }
      | undefined
  ): string {
    if (claim.reason === 'proposed-owner' || !authored) return claim.owner;
    if (endpointHidesProposed(authored.source.model, authored.source.element))
      return authored.source.model;
    if (endpointHidesProposed(authored.target.model, authored.target.element))
      return authored.target.model;
    const off = [authored.source.model, authored.target.model].find((id) => {
      const entry = composition?.state.projects.find((project) => project.model === id);
      return entry !== undefined && !entry.view.proposed;
    });
    return off ?? claim.owner;
  }
  function hiddenSwitch(modelId: string): string {
    return `${projectName(modelId)} Proposed`;
  }
  const linkedDiagrams = $derived(
    (links?.links?.links ?? []).filter((link) => link.from === selected || link.from === undefined)
  );
  function linkAvailability(link: DiagramLink): string {
    const status = links?.resolution.find((entry) => entry.model === link.target.model)?.status;
    if (status === 'unavailable') return 'Unavailable';
    if (status === 'invalid') return 'Invalid';
    if (composition?.state.projects.some((project) => project.model === link.target.model))
      return 'Open';
    return 'Not opened';
  }
  function linkRecovery(link: DiagramLink): string | undefined {
    return links?.resolution.find((entry) => entry.model === link.target.model)?.message;
  }
  const shadeLabel = $derived(
    connection?.claim.title ??
      selectedElement?.title ??
      (selectedType === 'outside'
        ? 'Connected beyond this view'
        : (selectedEdge?.title ?? 'Connection'))
  );
</script>

<InspectorShell {onsettled} {onclose} label={shadeLabel}>
  {#key `${model.id}:${selectedType}:${selected}`}
    <InspectorContent
      kind={selectedElement?.kind ?? (selectedType === 'outside' ? 'context' : 'relationship')}
      title={connection?.claim.title ??
        selectedElement?.title ??
        (selectedType === 'outside'
          ? 'Connected beyond this view'
          : (selectedEdge?.title ?? 'Connection'))}
      proposed={(selectedElement ?? selectedEdge)?.status === 'proposed' ||
        connection?.claim.status === 'proposed'}
    >
      {#if connection}
        <p class="route connection-route">
          {connection.route.source.project}{#if connection.route.source.component}{' / '}{connection
              .route.source.component}{/if}
          {' → '}
          {connection.route.target.project}{#if connection.route.target.component}{' / '}{connection
              .route.target.component}{/if}
        </p>
        <p class="description">
          {connection.claim.description || 'An authored cross-project connection.'}
        </p>
        <p class="meta">
          {connection.claim.kind} ·
          <span class="status-chip" class:proposed={connection.claim.status === 'proposed'}
            >{connection.claim.status === 'proposed' ? 'Proposed' : 'Current'}</span
          >
        </p>
        <section aria-label="Exact endpoints">
          <h3>Endpoints</h3>
          <dl>
            <dt>Source</dt>
            <dd>
              <code
                >{connection.endpoints.source.model} / {connection.endpoints.source.element}</code
              >
            </dd>
            <dt>Target</dt>
            <dd>
              <code
                >{connection.endpoints.target.model} / {connection.endpoints.target.element}</code
              >
            </dd>
          </dl>
        </section>
        {#if connection.underlying.length}
          <section aria-label="Underlying claims">
            <h3>
              Underlying claims <span>{connection.count}</span>
            </h3>
            <div class="item-list">
              {#each connection.underlying as claim (`${claim.owner}/${claim.connectionId}`)}
                <InspectorDisclosure>
                  {#snippet heading()}
                    <span class="item-summary"
                      ><strong class="item-title">{claim.owner} / {claim.connectionId}</strong
                      ></span
                    >
                  {/snippet}
                  <dl>
                    <dt>Owner</dt>
                    <dd><code>{claim.owner}</code></dd>
                    <dt>Endpoints</dt>
                    <dd>
                      <code
                        >{claim.endpoints.source.model} / {claim.endpoints.source.element} → {claim
                          .endpoints.target.model} / {claim.endpoints.target.element}</code
                      >
                    </dd>
                  </dl>
                  {#if claim.evidence.length}
                    <h3>Source references</h3>
                    {#each claim.evidence as evidence}<code class="evidence">{evidence}</code
                      >{/each}
                  {/if}
                </InspectorDisclosure>
              {/each}
            </div>
          </section>
        {/if}
        <div class="secondary">
          <InspectorDisclosure label="Claim & evidence">
            <dl>
              <dt>Owner</dt>
              <dd><code>{connection.owner}</code></dd>
              <dt>Title</dt>
              <dd>{connection.claim.title}</dd>
              <dt>Kind</dt>
              <dd>{connection.claim.kind}</dd>
              {#if connection.representatives.source.title}<dt>Drawn at source</dt>
                <dd>{connection.representatives.source.title}</dd>{/if}
              {#if connection.representatives.target.title}<dt>Drawn at target</dt>
                <dd>{connection.representatives.target.title}</dd>{/if}
              {#if compositionSelection?.kind === 'connection'}<dt>Stable ID</dt>
                <dd><code>{compositionSelection.connectionId}</code></dd>{/if}
            </dl>
            {#if connection.claim.evidence.length}
              <h3>Source references</h3>
              {#each connection.claim.evidence as evidence}<code class="evidence">{evidence}</code
                >{/each}
              <p class="detail-copy">Authored references, not automatic verification.</p>
            {/if}
          </InspectorDisclosure>
        </div>
      {:else if selectedElement}
        {#if selectedElement.technology}<p class="meta">{selectedElement.technology}</p>{/if}
        {#if selectedElement.description}<p class="description">
            {selectedElement.description}
          </p>{/if}
        {#if children.length}
          <section aria-label="Inside this component">
            <h3>Inside this component <span>{children.length}</span></h3>
            {#each children as child}
              <button class="child-link" onclick={() => inspectElement(child.id)}>
                <span>{child.title}</span>
                {#if child.status === 'proposed'}<small class="status-chip proposed">Proposed</small
                  >{/if}
                <ChevronRight size={13} />
              </button>
            {/each}
            <div class="component-actions">
              <button class="button" onclick={() => focus(selectedElement!.id)}
                >Focus this component<Maximize size={14} /></button
              >
              <button class="button" onclick={() => toggle(selectedElement!.id)}
                >{view.expanded.includes(selectedElement.id)
                  ? 'Collapse component'
                  : 'Expand component'}<ArrowUpRight size={14} /></button
              >
            </div>
          </section>
        {/if}
        {#if selectedBoundaries.length}
          <section aria-label="Boundary membership">
            <h3>Boundary membership</h3>
            <div class="item-list">
              {#each selectedBoundaries as boundary}
                <InspectorDisclosure>
                  {#snippet heading()}<span class="item-title boundary-name"
                      ><i style={`background:${boundary.color}`}></i>{boundary.title}</span
                    >{/snippet}
                  <p class="detail-copy">{boundary.description}</p>
                </InspectorDisclosure>
              {/each}
            </div>
          </section>
        {/if}
        <section aria-label="Connections">
          <h3>Connected to <span>{details?.relationships.length ?? 0}</span></h3>
          <div class="item-list">
            {#each details?.relationships ?? [] as relation}
              <div class="connection-item">
                <InspectorDisclosure>
                  {#snippet heading()}
                    <span class="item-summary"
                      ><strong class="item-title">{relation.title}</strong
                      >{#if relation.status === 'proposed'}<small class="status-chip proposed"
                          >Proposed</small
                        >{/if}</span
                    >
                  {/snippet}
                  {#if relation.description}<p class="detail-copy">{relation.description}</p>{/if}
                  <dl>
                    <dt>Kind</dt>
                    <dd>{relation.kind}</dd>
                    <dt>Stable ID</dt>
                    <dd><code>{relation.id}</code></dd>
                    <dt>Endpoints</dt>
                    <dd><code>{relation.source} → {relation.target}</code></dd>
                  </dl>
                </InspectorDisclosure>
                <button
                  class="inspect-link route"
                  aria-label={`Inspect ${name(relation.source === selectedElement?.id ? relation.target : relation.source)}`}
                  onclick={() =>
                    inspectElement(
                      relation.source === selectedElement?.id ? relation.target : relation.source
                    )}
                  >{name(relation.source)} → {name(relation.target)}<ArrowUpRight
                    size={12}
                  /></button
                >
              </div>
            {:else}<p class="meta">No connections in this view.</p>{/each}
          </div>
        </section>
        {#if hiddenClaims.length}
          <section aria-label="Hidden by proposal switch" data-hidden-claims>
            <h3>Hidden by proposal switch <span>{hiddenClaims.length}</span></h3>
            <div class="item-list">
              {#each hiddenClaims as claim (`${claim.owner}/${claim.connectionId}`)}
                {@const authored = composition?.links?.[claim.owner]?.connections.find(
                  (entry) => entry.id === claim.connectionId
                )}
                {@const switchProject = showProposedTarget(claim, authored)}
                <div
                  class="linked-item"
                  data-hidden-claim={claim.connectionId}
                  data-hidden-owner={claim.owner}
                  data-hidden-reason={claim.reason}
                >
                  <strong class="item-title">{hiddenTitle(claim)}</strong>
                  <p class="meta">
                    Hidden because {hiddenSwitch(switchProject)} is off.
                  </p>
                  {#if authored}
                    <p class="detail-copy">
                      <code
                        >{authored.source.model} / {authored.source.element} → {authored.target
                          .model} / {authored.target.element}</code
                      >
                    </p>
                  {/if}
                  {#if onshowproposed}
                    <button
                      class="button"
                      data-show-proposed={switchProject}
                      onclick={() => onshowproposed(switchProject)}>Show proposed</button
                    >
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}
        {#if linkedDiagrams.length}
          <section aria-label="Linked diagrams">
            <h3>Linked diagrams <span>{linkedDiagrams.length}</span></h3>
            <div class="item-list">
              {#each linkedDiagrams as link (link.id)}
                <div
                  class="linked-item"
                  data-link-id={link.id}
                  data-target={link.target.model}
                  data-status={linkAvailability(link).toLowerCase().replace(' ', '-')}
                >
                  <div class="linked-summary">
                    <strong class="item-title">{link.title}</strong>
                    <span class="linked-status">{linkAvailability(link)}</span>
                  </div>
                  <p class="meta">
                    {link.target.model}{#if link.target.scene}
                      · {link.target.scene}{/if}
                  </p>
                  {#if linkRecovery(link)}<p class="detail-copy">{linkRecovery(link)}</p>{/if}
                  {#if onopenlink}<button
                      class="button linked-open"
                      data-open-link={link.id}
                      onclick={() => onopenlink(link)}>Open linked diagram</button
                    >{/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}
      {:else if selectedType === 'outside'}
        <p class="meta">{diagram?.outside?.length ?? 0} connections beyond this view</p>
        <p class="description">
          These authored relationships cross the focus boundary. They remain part of the model.
        </p>
        <section aria-label="Connections beyond this view">
          <h3>Connections</h3>
          <div class="item-list">
            {#each diagram?.outside ?? [] as relation}
              <div class="connection-item">
                <InspectorDisclosure>
                  {#snippet heading()}<span class="item-summary"
                      ><strong class="item-title">{relation.title}</strong><span class="route"
                        >{name(relation.source)} → {name(relation.target)}</span
                      >{#if relation.status === 'proposed'}<small class="status-chip proposed"
                          >Proposed</small
                        >{/if}</span
                    >{/snippet}
                  {#if relation.description}<p class="detail-copy">{relation.description}</p>{/if}
                  <dl>
                    <dt>Stable ID</dt>
                    <dd><code>{relation.id}</code></dd>
                    <dt>Endpoints</dt>
                    <dd><code>{relation.source} → {relation.target}</code></dd>
                  </dl>
                </InspectorDisclosure>
                <button class="inspect-link" onclick={() => inspectElement(relation.source)}
                  >Inspect {name(relation.source)}<ArrowUpRight size={12} /></button
                >
                <button class="inspect-link" onclick={() => inspectElement(relation.target)}
                  >Inspect {name(relation.target)}<ArrowUpRight size={12} /></button
                >
              </div>
            {/each}
          </div>
        </section>
        <button class="button expand-button" onclick={fullSystem}>Show whole system</button>
      {:else if selectedEdge}
        <p class="meta">
          {selectedEdge.kind} ·
          <span class="status-chip" class:proposed={selectedEdge.status === 'proposed'}
            >{selectedEdge.status === 'proposed' ? 'Proposed' : 'Current'}</span
          >
        </p>
        <p class="description">
          {selectedEdge.description || 'An authored connection between components.'}
        </p>
        <div class="connection-pair">
          <button onclick={() => inspectElement(selectedEdge!.source)}
            >{name(selectedEdge.source)}</button
          ><span>↓</span><button onclick={() => inspectElement(selectedEdge!.target)}
            >{name(selectedEdge.target)}</button
          >
        </div>
        <section aria-label="Underlying relationships">
          <h3>Underlying relationships <span>{selectedEdge.underlying.length}</span></h3>
          <div class="item-list">
            {#each selectedEdge.underlying as id}
              {@const original = model.relationships.find((r) => r.id === id)}
              {#if original}
                <InspectorDisclosure>
                  {#snippet heading()}<span class="item-summary"
                      ><strong class="item-title">{original.title}</strong><span class="route"
                        >{name(original.source)} → {name(original.target)}</span
                      >{#if original.status === 'proposed'}<small class="status-chip proposed"
                          >Proposed</small
                        >{/if}</span
                    >{/snippet}
                  {#if original.description}<p class="detail-copy">{original.description}</p>{/if}
                  <dl>
                    <dt>Stable ID</dt>
                    <dd><code>{id}</code></dd>
                    <dt>Endpoints</dt>
                    <dd><code>{original.source} → {original.target}</code></dd>
                  </dl>
                </InspectorDisclosure>
              {/if}
            {/each}
          </div>
        </section>
      {/if}
      {#if !connection}
        <div class="secondary">
          <InspectorDisclosure label="Technical details">
            <dl>
              {#if selectedElement}
                <dt>Stable ID</dt>
                <dd><code>{selectedElement.id}</code></dd>
                <dt>Kind</dt>
                <dd>{selectedElement.kind}</dd>
                {#if selectedElement.parent}<dt>Parent ID</dt>
                  <dd><code>{selectedElement.parent}</code></dd>{/if}
                {#if selectedBoundaries.length}<dt>Boundary IDs</dt>
                  <dd>
                    <code>{selectedBoundaries.map((boundary) => boundary.id).join(', ')}</code>
                  </dd>{/if}
              {:else if selectedEdge}
                <dt>Stable ID</dt>
                <dd><code>{selectedEdge.id}</code></dd>
                <dt>Endpoints</dt>
                <dd><code>{selectedEdge.source} → {selectedEdge.target}</code></dd>
                <dt>Original IDs</dt>
                <dd><code>{selectedEdge.underlying.join(', ')}</code></dd>
              {:else}
                <dt>Original IDs</dt>
                <dd><code>{diagram?.outside?.map((relation) => relation.id).join(', ')}</code></dd>
              {/if}
            </dl>
          </InspectorDisclosure>
          {#if model.provenance || selectedElement?.evidence.length}
            <InspectorDisclosure label="Sources & context">
              {#if selectedElement?.evidence.length}
                <h3>Source references</h3>
                {#each selectedElement.evidence as evidence}<code class="evidence">{evidence}</code
                  >{/each}
                <p class="detail-copy">Authored references, not automatic verification.</p>
              {/if}
              {#if model.provenance}<p class="context">{model.provenance}</p>{/if}
            </InspectorDisclosure>
          {/if}
        </div>
      {/if}
    </InspectorContent>
  {/key}
</InspectorShell>

<style>
  .meta {
    padding-top: 3px;
  }
  .component-actions {
    display: grid;
    gap: 8px;
    margin-top: 16px;
  }
  .component-actions button {
    justify-content: space-between;
  }
  .child-link {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ui-text, #283d34);
    gap: 8px;
  }
  .child-link > span {
    flex: 1;
    overflow-wrap: anywhere;
  }
  .child-link :global(svg) {
    flex-shrink: 0;
  }
  .boundary-name {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .boundary-name i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .inspect-link {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: none;
    padding: 8px 0;
    font-size: 12px;
    text-align: left;
    color: var(--ui-accent, #365b42);
    overflow-wrap: anywhere;
  }
  .inspect-link.route {
    margin-top: 5px;
    padding: 0;
  }
  .inspect-link :global(svg) {
    flex-shrink: 0;
  }
  .connection-route {
    font-size: 12px;
    line-height: 1.55;
    color: var(--ui-text, #283d34);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .linked-item {
    display: grid;
    gap: 6px;
    padding: 12px;
    border: 1px solid var(--ui-border, #d9dfdb);
    border-radius: 10px;
  }
  .linked-summary {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .linked-status {
    flex: 0 0 auto;
    font-size: 10px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--ui-muted, #73806e);
  }
  .linked-open {
    justify-self: start;
  }
</style>
