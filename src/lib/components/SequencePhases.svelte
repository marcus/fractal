<script lang="ts">
  import { ChevronDown, EyeOff, Flag, Minus } from '@marcusv/roc/svelte/outline';
  import type { SequenceJourney, SequenceViewState } from '$lib/sequence/types';
  import {
    phaseEntries,
    phaseSubtree,
    setPhaseVisibility,
    showAllPhases,
    visiblePhaseIds
  } from '$lib/sequence/visibility';

  let {
    journey,
    view,
    onchange
  }: {
    journey: SequenceJourney;
    view: SequenceViewState;
    onchange: (state: SequenceViewState) => void;
  } = $props();

  const phases = $derived(phaseEntries(journey));
  const visible = $derived(visiblePhaseIds(journey, view));
  const allVisible = $derived(visible.length === phases.length);
  const nothingFiltered = $derived(
    view.visiblePhases === undefined && view.scopePhase === undefined
  );
  const allExpanded = $derived(phases.every((phase) => !view.collapsedPhases.includes(phase.id)));

  function toggleFold(id: string) {
    onchange({
      ...view,
      collapsedPhases: view.collapsedPhases.includes(id)
        ? view.collapsedPhases.filter((phase) => phase !== id)
        : [...view.collapsedPhases, id]
    });
  }

  function toggleAllFolds() {
    const phaseIds = new Set(phases.map((phase) => phase.id));
    onchange({
      ...view,
      collapsedPhases: allExpanded
        ? [...new Set([...view.collapsedPhases, ...phaseIds])]
        : view.collapsedPhases.filter((id) => !phaseIds.has(id))
    });
  }
</script>

<div class="section-label phases-label">
  <span class="section-name"><Flag size={12} aria-hidden="true" />Phases</span>
  <span class="outline-meta">
    <span aria-live="polite" aria-label={`${visible.length} of ${phases.length} phases shown`}
      >{allVisible ? phases.length : `${visible.length} of ${phases.length}`}</span
    >
    <button
      class="outline-show-all"
      disabled={nothingFiltered && allExpanded}
      title="Show and expand every phase"
      onclick={() => onchange(showAllPhases(journey, view))}>Show all</button
    >
    <button
      class="outline-fold-all"
      class:expanded={allExpanded}
      aria-label={allExpanded ? 'Collapse all phases' : 'Expand all phases'}
      title={allExpanded ? 'Collapse all phases' : 'Expand all phases'}
      onclick={toggleAllFolds}><ChevronDown size={11} aria-hidden="true" /></button
    >
  </span>
</div>
<div class="outline-rows" aria-label="Phase visibility">
  {#each phases as phase (phase.id)}
    {@const shown = visible.includes(phase.id)}
    {@const subtree = phaseSubtree(journey, phase.id)}
    {@const partial =
      subtree.some((id) => visible.includes(id)) && !subtree.every((id) => visible.includes(id))}
    {@const contextOnly = !shown && partial}
    {@const visibilityLabel = partial
      ? `Show all phases in ${phase.title}`
      : `${shown ? 'Hide' : 'Show'} ${phase.title}`}
    {@const expanded = contextOnly || !view.collapsedPhases.includes(phase.id)}
    <div class="outline-row" style={`--depth:${phase.depth}`}>
      <button
        class="outline-fold"
        disabled={contextOnly}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${phase.title}`}
        aria-expanded={expanded}
        title={`${expanded ? 'Collapse' : 'Expand'} ${phase.title}`}
        onclick={() => toggleFold(phase.id)}><ChevronDown size={11} aria-hidden="true" /></button
      >
      <button
        class="outline-title"
        aria-pressed={partial ? 'mixed' : shown}
        aria-label={visibilityLabel}
        title={visibilityLabel}
        onclick={() => onchange(setPhaseVisibility(journey, view, phase.id, 'toggle'))}
      >
        <span class="outline-state" aria-hidden="true">
          {#if partial}<Minus size={10} />{:else if shown}<span class="dot"></span>{:else}<EyeOff
              size={10}
            />{/if}
        </span>
        <span class="name">{phase.title}</span>
      </button>
      <button
        class="outline-action"
        aria-label={`Show only ${phase.title}`}
        title={`Show only ${phase.title}`}
        onclick={() => onchange(setPhaseVisibility(journey, view, phase.id, 'only'))}>Only</button
      >
    </div>
  {/each}
</div>

<style>
  .phases-label {
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
</style>
