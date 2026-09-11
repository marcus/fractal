<script lang="ts">
  import CornerControl from './CornerControl.svelte';
  /**
   * The one canvas control in the corner, beside the navigation toggle. Zooming in and out stays
   * on the wheel, pinch, and keyboard: a zoom pill with a percentage of nothing in particular was
   * clutter, and stepping it by button was clumsy.
   */
  let { onfit, label = 'Fit diagram' }: { onfit: () => void; label?: string } = $props();
</script>

<CornerControl class="fit-control" {label} onclick={onfit}>⌗</CornerControl>
