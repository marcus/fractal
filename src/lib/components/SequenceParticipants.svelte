<script lang="ts">
  import { ChevronDown, EyeOff, Minus, MoreHorizontal, Users } from '@marcusv/roc/svelte/outline';
  import type {
    SequenceJourney,
    SequenceParticipant,
    SequenceViewState
  } from '$lib/sequence/types';

  let {
    journey,
    view,
    onvisibility,
    ontogglegroup
  }: {
    journey: SequenceJourney;
    view: SequenceViewState;
    onvisibility: (id: string, action: 'toggle' | 'only' | 'all') => void;
    ontogglegroup: (id: string) => void;
  } = $props();
  const id = $props.id();
  let folded = $state<string[]>([]);
  let menuGroup = $state<string | null>(null);
  let menuOpen = $state(false);
  let panel: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let position = $state({ left: 0, top: 0 });
  const activeGroup = $derived(journey.groups.find((group) => group.id === menuGroup));
  const total = $derived(journey.participants.length);
  const shown = $derived(total - view.hiddenParticipants.length);
  const allExpanded = $derived(journey.groups.every((group) => !folded.includes(group.id)));
  const grouped = $derived(new Set(journey.groups.flatMap((group) => group.participants)));

  function locate(event: MouseEvent, groupId: string) {
    trigger = event.currentTarget as HTMLButtonElement;
    menuGroup = groupId;
    const rect = trigger.getBoundingClientRect();
    position = {
      left: Math.max(8, Math.min(innerWidth - 188, rect.right - 180)),
      top: Math.max(8, Math.min(innerHeight - 64, rect.bottom + 4))
    };
  }
  function close() {
    if (panel?.matches(':popover-open')) panel.hidePopover();
  }
  function toggleFold(groupId: string) {
    folded = folded.includes(groupId)
      ? folded.filter((item) => item !== groupId)
      : [...folded, groupId];
  }
  function toggleAllFolds() {
    folded = allExpanded ? journey.groups.map((group) => group.id) : [];
  }
  function showAll() {
    folded = [];
    onvisibility('', 'all');
  }
</script>

<svelte:window onresize={close} />
<div class="section-label participants-label">
  <span class="section-name"><Users size={12} aria-hidden="true" />Participants</span>
  <span class="outline-meta">
    <span aria-live="polite" aria-label={`${shown} of ${total} participants shown`}
      >{shown === total ? total : `${shown} of ${total}`}</span
    >
    <button
      class="outline-show-all"
      disabled={shown === total && allExpanded}
      title="Show every participant and expand every group"
      onclick={showAll}>Show all</button
    >
    {#if journey.groups.length}
      <button
        class="outline-fold-all"
        class:expanded={allExpanded}
        aria-label={allExpanded ? 'Collapse all groups' : 'Expand all groups'}
        title={allExpanded ? 'Collapse all groups' : 'Expand all groups'}
        onclick={toggleAllFolds}><ChevronDown size={11} aria-hidden="true" /></button
      >
    {/if}
  </span>
</div>
<div class="outline-rows" aria-label="Participant visibility">
  {#each journey.groups as group, index (group.id)}
    {@const expanded = !folded.includes(group.id)}
    {@const hiddenMembers = group.participants.filter((member) =>
      view.hiddenParticipants.includes(member)
    ).length}
    {@const visible = hiddenMembers === 0}
    {@const partial = hiddenMembers > 0 && hiddenMembers < group.participants.length}
    {@const visibilityLabel = partial
      ? `Show all participants in ${group.title}`
      : `${visible ? 'Hide' : 'Show'} ${group.title} participants`}
    <div class="outline-row">
      <button
        class="outline-fold"
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.title}`}
        aria-expanded={expanded}
        aria-controls={`${id}-members-${index}`}
        title={`${expanded ? 'Collapse' : 'Expand'} ${group.title}`}
        onclick={() => toggleFold(group.id)}><ChevronDown size={11} aria-hidden="true" /></button
      >
      <button
        class="outline-title"
        aria-pressed={partial ? 'mixed' : visible}
        aria-label={visibilityLabel}
        title={visibilityLabel}
        onclick={() => onvisibility(group.id, 'toggle')}
      >
        <span class="outline-state" aria-hidden="true">
          {#if partial}<Minus size={10} />{:else if visible}<span class="dot"></span>{:else}<EyeOff
              size={10}
            />{/if}
        </span>
        <span class="name">{group.title}</span>
        {#if !expanded}<span class="count">{group.participants.length}</span>{/if}
      </button>
      <button
        class="outline-action"
        aria-label={`Show only ${group.title}`}
        title={`Show only ${group.title}`}
        onclick={() => onvisibility(group.id, 'only')}>Only</button
      >
      <button
        class="lane-options"
        aria-label={`${group.title} lane options`}
        title="Lane options"
        popovertarget={`${id}-lanes`}
        aria-expanded={menuOpen && menuGroup === group.id}
        onclick={(event) => locate(event, group.id)}><MoreHorizontal size={14} /></button
      >
    </div>
    <div id={`${id}-members-${index}`} class="outline-rows" hidden={!expanded}>
      {#each journey.participants.filter( (participant) => group.participants.includes(participant.id) ) as participant (participant.id)}
        {@render row(participant, 1)}
      {/each}
    </div>
  {/each}
  {#each journey.participants.filter((participant) => !grouped.has(participant.id)) as participant (participant.id)}
    {@render row(participant, 0)}
  {/each}
</div>
<div
  bind:this={panel}
  id={`${id}-lanes`}
  class="lane-popover"
  popover="auto"
  role="region"
  aria-label={activeGroup ? `${activeGroup.title} lane options` : 'Lane options'}
  ontoggle={(event) => (menuOpen = event.newState === 'open')}
  style={`left:${position.left}px;top:${position.top}px`}
>
  {#if activeGroup}
    <button
      onclick={() => {
        ontogglegroup(activeGroup.id);
        close();
        trigger?.focus();
      }}
    >
      {view.collapsedGroups.includes(activeGroup.id) ? 'Separate lanes' : 'Combine lanes'}
    </button>
  {/if}
</div>

{#snippet row(participant: SequenceParticipant, depth: number)}
  {@const visible = !view.hiddenParticipants.includes(participant.id)}
  <div class="outline-row" style={`--depth:${depth}`}>
    <span class="outline-fold" aria-hidden="true"></span>
    <button
      class="outline-title"
      aria-label={`${participant.title} visibility`}
      aria-pressed={visible}
      title={`${visible ? 'Hide' : 'Show'} ${participant.title}`}
      onclick={() => onvisibility(participant.id, 'toggle')}
    >
      <span class="outline-state" style={`--mark:${participant.color}`} aria-hidden="true"
        >{#if visible}<span class="dot"></span>{:else}<EyeOff size={10} />{/if}</span
      >
      <span class="name">{participant.title}</span>
    </button>
    <button
      class="outline-action"
      aria-label={`Show only ${participant.title}`}
      title={`Show only ${participant.title}`}
      onclick={() => onvisibility(participant.id, 'only')}>Only</button
    >
  </div>
{/snippet}

<style>
  .participants-label {
    margin-top: 26px;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .lane-options {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    min-height: 32px;
    padding: 6px;
    flex-shrink: 0;
    background: transparent;
    border: 0;
    color: var(--ui-muted, #7d887a);
  }
  .lane-popover {
    position: fixed;
    inset: auto;
    margin: 0;
    width: 180px;
    max-width: calc(100vw - 16px);
    padding: 5px;
    border: 0;
    border-radius: 6px;
    background: var(--ui-surface, #fff);
    color: var(--ui-text, #283d34);
    box-shadow: 0 4px 18px #22382b20;
  }
  .lane-popover button {
    width: 100%;
    padding: 8px 12px;
    text-align: left;
    font-size: 11px;
    background: transparent;
    border: 0;
  }
  .lane-popover button:hover {
    background: var(--ui-hover, #edf1e7);
  }
  @media (pointer: coarse) {
    .lane-options,
    .lane-popover button {
      min-height: 44px;
    }
    .lane-options {
      min-width: 44px;
    }
  }
</style>
