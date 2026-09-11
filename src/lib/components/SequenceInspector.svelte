<script lang="ts">
  import InspectorContent from './InspectorContent.svelte';
  import InspectorDisclosure from './InspectorDisclosure.svelte';
  import type {
    SequenceColumn,
    SequenceJourney,
    SequenceMessage,
    SequenceRow
  } from '$lib/sequence/types';

  let {
    row,
    column,
    messages,
    journey,
    architectureHref
  }: {
    row?: SequenceRow;
    column?: SequenceColumn;
    messages: SequenceMessage[];
    journey: SequenceJourney;
    architectureHref: (id: string) => string;
  } = $props();
  const participantName = (id: string) =>
    journey.participants.find((item) => item.id === id)?.title ?? id;
  const singleMessage = $derived(row?.type === 'message' ? messages[0] : undefined);
  const members = $derived(
    column ? journey.participants.filter((item) => column.memberIds.includes(item.id)) : []
  );
  const kind = $derived(
    row
      ? row.type === 'message'
        ? row.kind
        : row.type === 'phase'
          ? 'Phase'
          : row.type === 'hidden'
            ? 'Omitted interactions'
            : 'Internal interactions'
      : column && column.memberIds.length > 1
        ? 'Participant group'
        : 'Participant'
  );
</script>

<InspectorContent
  class="sequence-inspector"
  kind={kind ?? 'Interaction'}
  title={row?.title ?? column?.title ?? ''}
>
  {#if row}
    {#if singleMessage}
      <p class="route">
        {participantName(singleMessage.from)} → {participantName(singleMessage.to)}
      </p>
    {:else}
      <p class="meta">
        {row.messageIds.length} interaction{row.messageIds.length === 1
          ? ''
          : 's'}{#if row.hiddenMessageIds.length}<span class="omission">
            · {row.hiddenMessageIds.length} hidden</span
          >{/if}
      </p>
    {/if}
    {#if row.description}<p class="description">{row.description}</p>{/if}
    {#if !singleMessage && messages.length}
      <section class="interactions" aria-label="Interactions">
        <h3>Interactions</h3>
        <ol>
          {#each messages as message, index (message.id)}
            <li>
              <span class="number">{String(index + 1).padStart(2, '0')}</span>
              <InspectorDisclosure>
                {#snippet heading()}
                  <span class="interaction-summary item-summary"
                    ><strong class="item-title">{message.title}</strong><span class="route"
                      >{participantName(message.from)} → {participantName(message.to)}</span
                    >{#if row.hiddenMessageIds.includes(message.id)}<span class="omission"
                        >Hidden by participant visibility</span
                      >{/if}</span
                  >
                {/snippet}
                <div class="interaction-detail">
                  {#if message.description}<p class="detail-copy">{message.description}</p>{/if}
                  <dl>
                    <dt>Kind</dt>
                    <dd>{message.kind}</dd>
                    <dt>Stable ID</dt>
                    <dd><code>{message.id}</code></dd>
                    <dt>Endpoints</dt>
                    <dd><code>{message.from} → {message.to}</code></dd>
                  </dl>
                </div>
              </InspectorDisclosure>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  {:else if column}
    {#if members.length > 1}<p class="meta">{members.length} participants</p>{/if}
    <div class="members">
      {#each members as member (member.id)}
        <div>
          {#if members.length > 1}<h3>{member.title}</h3>{/if}
          {#if member.description}<p class="description">{member.description}</p>{/if}
        </div>
      {/each}
    </div>
    {#if column.elementIds.length}
      <section class="architecture">
        <h3>In the architecture</h3>
        {#each column.elementIds as element}<a
            href={architectureHref(element)}
            title={`Open ${element} in the architecture studio`}
            >{journey.participants.find((member) => member.element === element)?.title ??
              element}</a
          >{/each}
      </section>
    {/if}
  {/if}
  <div class="secondary">
    <InspectorDisclosure label="Technical details">
      <dl>
        <dt>Stable ID</dt>
        <dd><code>{row?.id ?? column?.id}</code></dd>
        {#if row}
          {#if row.parent}<dt>Phase ID</dt>
            <dd><code>{row.parent}</code></dd>{/if}
          {#if singleMessage}<dt>Endpoints</dt>
            <dd><code>{singleMessage.from} → {singleMessage.to}</code></dd>{/if}
          <dt>Originals</dt>
          <dd>{row.messageIds.length} message{row.messageIds.length === 1 ? '' : 's'}</dd>
          {#if row.hiddenMessageIds.length}<dt>Hidden IDs</dt>
            <dd><code>{row.hiddenMessageIds.join(', ')}</code></dd>{/if}
        {:else if column}
          <dt>Member IDs</dt>
          <dd><code>{column.memberIds.join(', ')}</code></dd>
          <dt>Element IDs</dt>
          <dd><code>{column.elementIds.join(', ') || 'Unmapped'}</code></dd>
        {/if}
      </dl>
    </InspectorDisclosure>
    {#if journey.provenance}
      <InspectorDisclosure label="Sources & context">
        <p class="context">{journey.provenance}</p>
      </InspectorDisclosure>
    {/if}
  </div>
</InspectorContent>

<style>
  ol {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 23px;
  }
  li {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 10px;
  }
  .number {
    font-size: 10px;
    color: var(--ui-subtle, #8b9785);
    padding-top: 3px;
    font-variant-numeric: tabular-nums;
  }
  .omission {
    color: var(--ui-muted, #73806e);
    font-size: 11px;
  }
  .interaction-summary .omission {
    display: block;
    margin-top: 5px;
    font-style: italic;
  }
  .interaction-detail {
    margin-top: 12px;
  }
  .architecture a {
    display: block;
    font-size: 12px;
    margin: 8px 0;
    overflow-wrap: anywhere;
  }
  .members h3 {
    margin: 22px 0 5px;
  }
</style>
