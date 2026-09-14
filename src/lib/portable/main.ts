import { mount } from 'svelte';
import '@fontsource-variable/inter';
import '../../app.css';
import Viewer from './Viewer.svelte';
import CompositionReader from './CompositionReader.svelte';
import { isLinkedDocument, LINKED_CONTRACT_VERSION, type AnyPortableDocument } from './document';

const snapshot = JSON.parse(
  globalThis.document.getElementById('fractal-document')!.textContent!
) as AnyPortableDocument;
const target = globalThis.document.getElementById('fractal-reader')!;
if (isLinkedDocument(snapshot)) {
  globalThis.document.getElementById('fractal-linked-required')?.remove();
  if (snapshot.linkedContract > LINKED_CONTRACT_VERSION) {
    target.textContent = `This document uses linked-project contract v${snapshot.linkedContract}. This reader supports v${LINKED_CONTRACT_VERSION} and will not present it as a complete composition.`;
  } else {
    mount(CompositionReader, { target, props: { document: snapshot } });
  }
} else {
  mount(Viewer, { target, props: { document: snapshot } });
}
