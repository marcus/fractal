/**
 * The single density seam for architecture nodes and containers. A theme can
 * eventually replace this profile without letting layout, canvas, and export drift.
 */
export const ARCHITECTURE_NODE_METRICS = {
  titleSize: 14,
  titleLineHeight: 20,
  containerPadding: 24,
  expandedChildTopGap: 17,
  expandedHeaderMin: 48,
  expandedHeaderBase: 28,
  expandedBodyExtra: 52,
  expandedContentX: 24,
  expandedTitleY: 30,
  /* The title row ends in a kind icon and, for containers, the expand control. */
  expandedTitleWidthInset: 84,
  collapsed: {
    minWidth: 212,
    maxWidth: 256,
    titleWidthInset: 84,
    descriptionWidthInset: 40,
    minHeight: 84,
    heightBase: 36,
    contentX: 20,
    titleY: 32
  },
  toggleRight: 10,
  toggleY: 13,
  toggleSize: 24,
  kindIconSize: 16,
  kindIconGap: 6
} as const;
