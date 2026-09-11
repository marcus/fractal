import { mount } from 'svelte';
import '@fontsource-variable/inter';
import '../../app.css';
import Viewer from './Viewer.svelte';
import type { PortableDocument } from './document';

const document = JSON.parse(
  globalThis.document.getElementById('fractal-document')!.textContent!
) as PortableDocument;
mount(Viewer, {
  target: globalThis.document.getElementById('fractal-reader')!,
  props: { document }
});
