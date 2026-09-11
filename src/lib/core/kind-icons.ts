/**
 * Element kinds render as icons on architecture nodes, in the canvas and in exports alike, and
 * the inspector's title row shows the same glyph for whatever is selected: an element, a
 * connection, or a sequence row. The primary glyphs are drawn for 16px in the studio’s rounded
 * outline language. Less common kinds retain Roc outlines
 * (node_modules/@marcusv/roc/dist/svg/outline). Shared inner markup keeps the canvas and
 * transport-neutral export identical: 24 units, currentColor, 1.5 stroke, no fills.
 */
export interface KindIcon {
  /** Stable glyph name, shared by kind aliases. */
  name: string;
  /** Inner SVG markup in a 24×24 viewBox. */
  markup: string;
}

/** One explicit outline envelope also works when the export has no inherited SVG styles. */
const outline = (markup: string) =>
  `<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`;

const ICONS = {
  // Structural family: a part with ports, a stack of parts, a bounded whole.
  component: outline(
    '<path d="M7 7V4h13v16H7v-3m0-6v2"/><rect x="3" y="7" width="8" height="4" rx="1"/><rect x="3" y="13" width="8" height="4" rx="1"/>'
  ),
  subsystem: outline(
    '<rect x="3" y="8" width="13" height="13" rx="2"/><path d="M8 5V3h13v13h-2"/>'
  ),
  system: outline(
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m12 7 5 5-5 5-5-5Z"/>'
  ),
  // Runtime: request rack, exchange seam, automated actor, executing process.
  service: outline(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18M7 8h2m-2 8h2"/>'
  ),
  adapter: outline('<path d="M3 7h14l-3-3m3 3-3 3M21 17H7l3-3m-3 3 3 3"/>'),
  agent: outline(
    '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12v2m8-2v2M9 17h6"/>'
  ),
  worker: outline(
    '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M10 9l5 3-5 3Z"/>'
  ),
  // Data and entry: the familiar cylinder and an inward arrow landing in a tray.
  database: outline(
    '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 4 16 4 16 0V6M4 12c0 4 16 4 16 0"/>'
  ),
  source: outline('<path d="M12 3v11m-4-4 4 4 4-4M4 13v7h16v-7"/>'),
  // Human surfaces and reusable code: screen, prompt, books, connected steps.
  experience: outline(
    '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5m-5 0h10"/>'
  ),
  terminal: outline(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>'
  ),
  library: outline(
    '<rect x="3" y="4" width="5" height="16" rx="1"/><path d="M12 4v16m3-15 4-1 3 15-4 1Z"/>'
  ),
  workflow: outline(
    '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M9 6h7a2 2 0 0 1 2 2v7m-3-3 3 3 3-3"/>'
  ),
  person: outline(
    '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>'
  ),
  external: outline('<path d="M13 3h8v8m0-8L10 14M9 4H4v16h16v-5"/>'),
  globe: outline(
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>'
  ),
  element: outline('<path d="m12 3 9 9-9 9-9-9Z"/>'),
  // Selections that are not elements: a connection between two parts, and a connection that
  // leaves the current view.
  relationship: outline(
    '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h8m-3-3 3 3-3 3"/>'
  ),
  context: outline('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M9 12h12m-4-4 4 4-4 4"/>'),
  // Sequence selections, drawn from the diagram's own vocabulary: lifelines, a band across them,
  // an arrow between them, a loop back to one, and the head of a lifeline.
  phase: outline('<path d="M6 3v18M18 3v18"/><rect x="3" y="8" width="18" height="8" rx="1.5"/>'),
  call: outline('<path d="M5 3v18M19 3v18M8 12h8m-3-3 3 3-3 3"/>'),
  return: outline('<path d="M5 3v18M19 3v18M16 12h-2m-2 0h-2m-2 0H8m3-3-3 3 3 3"/>'),
  async: outline('<path d="M5 3v18M19 3v18M8 12h8m-3-3 3 3"/>'),
  internal: outline('<path d="M8 3v18M8 8h7a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-4m2-2-2 2 2 2"/>'),
  omitted: outline('<path d="M6 3v18M18 3v18M9 12h.01M12 12h.01M15 12h.01"/>'),
  participant: outline(
    '<rect x="5" y="3" width="14" height="7" rx="1.5"/><path d="M12 10v3m0 3v2m0 2v1"/>'
  ),
  participants: outline(
    '<rect x="3" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><path d="M7 9v12M17 9v12"/>'
  ),

  hardDrive:
    '<rect width="18" height="16" x="3" y="4" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" rx="2"/><path stroke="currentColor" stroke-width="1.5" d="M3 14h18"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M16 17h2"/>',
  users:
    '<circle cx="9" cy="7.5" r="3.5" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M2.5 20.5v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1M16 7.13a3.5 3.5 0 0 1 0 6.5m3.5 6.87v-1a5 5 0 0 0-3-4.58"/>',
  package:
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16.5 9.4 7.55 4.21M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>',
  memory:
    '<rect width="20" height="10" x="2" y="7" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" rx="1"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M5 17v2m3-2v2m3-2v2m3-2v2m3-2v2m3-2v2M6 10.5v3m4-3v3m4-3v3m4-3v3"/>',
  fileText:
    '<path stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M6 3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5a1 1 0 0 0-.29-.71l-4.5-4.5A1 1 0 0 0 13.5 3z"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14 3v4.5a1 1 0 0 0 1 1h4"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M8 13h8m-8 3.5h5m-5-7h2"/>',
  broadcast:
    '<circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M8.46 15.54a5 5 0 0 1 0-7.07M15.54 8.46a5 5 0 0 1 0 7.07M5.64 18.36a9 9 0 0 1 0-12.73M18.36 5.64a9 9 0 0 1 0 12.73"/>',
  folderOpen:
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 20H2.5V6a1 1 0 0 1 1-1h5.59a1 1 0 0 1 .7.29L11.5 7H19a1 1 0 0 1 1 1v1.5"/><path stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M5.5 9.5h15a1 1 0 0 1 .97 1.24l-2 8a1 1 0 0 1-.97.76H3.47a1 1 0 0 1-.97-1.24l2-8a1 1 0 0 1 .97-.76z"/>',
  cloud:
    '<path stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M18 18H6.5a4.5 4.5 0 0 1-.42-8.98A7 7 0 0 1 19.5 11a3.5 3.5 0 0 1-1.5 7Z"/>',
  shield:
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m12 2.5-8 3v5.25c0 5.52 3.44 8.97 8 11.25 4.56-2.28 8-5.73 8-11.25V5.5z"/>',
  key: '<circle cx="8" cy="8" r="4" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m11 11 3 3m0 0 2-2m-2 2 4 4"/>',
  zap: '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.5 2h-7l-2 9h5L8 22 19 9h-6z"/>',
  gitBranch:
    '<circle cx="12" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="9" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M12 7v10"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 13c0-2.21 1.79-4 4-4"/>',
  smartphone:
    '<rect width="12" height="19" x="6" y="2.5" stroke="currentColor" stroke-width="1.5" rx="2"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M10.5 5h3"/>',
  clock:
    '<circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.5v6l4 2.5"/>',
  mail: '<rect width="18" height="14" x="3" y="5" stroke="currentColor" stroke-width="1.5" rx="2"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m3 7 9 6 9-6"/>',
  rows: '<rect width="18" height="8" x="3" y="3" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" rx="1"/><rect width="18" height="8" x="3" y="13" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" rx="1"/>',
  flask:
    '<path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M9 3h6"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10 3v6.5l-5.5 9a1.5 1.5 0 0 0 1.3 2.25h12.4a1.5 1.5 0 0 0 1.3-2.25l-5.5-9V3"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M7.5 15.5h9"/>',
  atom: '<circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1.5"/><ellipse cx="12" cy="12" stroke="currentColor" stroke-width="1.5" rx="9" ry="4"/><ellipse cx="12" cy="12" stroke="currentColor" stroke-width="1.5" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" stroke="currentColor" stroke-width="1.5" rx="9" ry="4" transform="rotate(120 12 12)"/>'
} as const;

type IconName = keyof typeof ICONS;

/** Kind → icon and a one-line reading of what that kind claims. Keys are normalised kinds. */
const KINDS: Record<string, { icon: IconName; hint: string }> = {
  component: { icon: 'component', hint: 'A part of the system with one clear responsibility.' },
  module: { icon: 'component', hint: 'A unit of code with a defined interface.' },
  subsystem: { icon: 'subsystem', hint: 'A group of parts that work as one larger unit.' },
  system: { icon: 'system', hint: 'A whole system, seen from the outside.' },
  container: { icon: 'package', hint: 'A deployable unit that hosts components.' },
  service: { icon: 'service', hint: 'A running process that serves requests.' },
  api: { icon: 'adapter', hint: 'An interface other parts call.' },
  gateway: { icon: 'adapter', hint: 'An entry point that routes requests inward.' },
  adapter: { icon: 'adapter', hint: 'A seam that lets one thing be swapped for another.' },
  store: { icon: 'database', hint: 'Where data is kept.' },
  database: { icon: 'database', hint: 'A database that holds records.' },
  cache: { icon: 'memory', hint: 'A fast, disposable copy of data.' },
  storage: { icon: 'hardDrive', hint: 'Durable file or object storage.' },
  file: { icon: 'fileText', hint: 'A file or document.' },
  document: { icon: 'fileText', hint: 'A file or document.' },
  queue: { icon: 'rows', hint: 'Work waiting in order to be picked up.' },
  topic: { icon: 'broadcast', hint: 'A stream that many parts can subscribe to.' },
  event: { icon: 'broadcast', hint: 'Something that happened, published for others.' },
  source: { icon: 'source', hint: 'Where information enters the system.' },
  repository: { icon: 'gitBranch', hint: 'A version-controlled source repository.' },
  agent: { icon: 'agent', hint: 'An automated actor that carries out work.' },
  model: { icon: 'atom', hint: 'A model that reasons or predicts.' },
  experience: { icon: 'experience', hint: 'What a person sees and uses.' },
  ui: { icon: 'experience', hint: 'What a person sees and uses.' },
  app: { icon: 'smartphone', hint: 'An application people install and open.' },
  application: { icon: 'smartphone', hint: 'An application people install and open.' },
  cli: { icon: 'terminal', hint: 'A command-line surface.' },
  tool: { icon: 'terminal', hint: 'A tool run on demand.' },
  library: { icon: 'library', hint: 'Shared code other parts depend on.' },
  workflow: { icon: 'workflow', hint: 'A sequence of steps run as one unit.' },
  pipeline: { icon: 'workflow', hint: 'A sequence of steps run as one unit.' },
  job: { icon: 'clock', hint: 'Work that runs on a schedule or in the background.' },
  scheduler: { icon: 'clock', hint: 'Decides when work runs.' },
  worker: { icon: 'worker', hint: 'A process that carries out queued work.' },
  process: { icon: 'worker', hint: 'A running process.' },
  actor: { icon: 'person', hint: 'A person or role that acts on the system.' },
  person: { icon: 'person', hint: 'A person who uses or operates the system.' },
  user: { icon: 'person', hint: 'A person who uses or operates the system.' },
  team: { icon: 'users', hint: 'A group of people.' },
  external: { icon: 'external', hint: 'Something outside this system.' },
  web: { icon: 'globe', hint: 'A website or web surface.' },
  cloud: { icon: 'cloud', hint: 'A hosted, managed service.' },
  policy: { icon: 'shield', hint: 'Rules that decide what is allowed.' },
  boundary: { icon: 'shield', hint: 'A trust or ownership boundary.' },
  secret: { icon: 'key', hint: 'Credentials or keys.' },
  function: { icon: 'zap', hint: 'A small unit of work run on demand.' },
  mail: { icon: 'mail', hint: 'Email or messaging.' },
  experiment: { icon: 'flask', hint: 'Something being tried, not settled.' },
  folder: { icon: 'folderOpen', hint: 'A collection of files.' },
  // What the inspector can select besides an element.
  relationship: { icon: 'relationship', hint: 'An authored connection between components.' },
  context: { icon: 'context', hint: 'Connections that cross the edge of this view.' },
  // What the sequence inspector can select.
  phase: { icon: 'phase', hint: 'A named stretch of a journey.' },
  interaction: { icon: 'call', hint: 'One participant acting on another.' },
  call: { icon: 'call', hint: 'A request from one participant to another.' },
  return: { icon: 'return', hint: 'A reply back to the participant that asked.' },
  async: { icon: 'async', hint: 'A message sent without waiting for a reply.' },
  internal_interactions: { icon: 'internal', hint: 'Interactions folded inside one participant.' },
  omitted_interactions: {
    icon: 'omitted',
    hint: 'Interactions hidden by participant visibility.'
  },
  participant: { icon: 'participant', hint: 'Someone or something that takes part in a journey.' },
  participant_group: { icon: 'participants', hint: 'Participants shown as one lane.' }
};

const FALLBACK = { icon: 'element' as IconName, hint: 'An element kind this model declares.' };

const normalise = (kind: string) =>
  kind
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

/** Readable kind for labels: `data_store` → `Data store`; proposed elements say so first. */
export function kindTitle(kind: string, status?: 'current' | 'proposed'): string {
  const words = normalise(kind).replace(/_/g, ' ');
  const readable = words.charAt(0).toUpperCase() + words.slice(1);
  return status === 'proposed' ? `Proposed ${words}` : readable;
}

/** Match the whole kind, then its last word (`data_store` → store), then the fallback. */
function lookup(kind: string) {
  const key = normalise(kind);
  return KINDS[key] ?? KINDS[key.split('_').pop() ?? ''] ?? FALLBACK;
}

export function kindHint(kind: string): string {
  return lookup(kind).hint;
}

export function kindIcon(kind: string): KindIcon {
  const entry = lookup(kind);
  return { name: entry.icon, markup: ICONS[entry.icon] };
}
