import { listProjects } from '$lib/server/models';

/**
 * Compile the catalog once while the server is starting, not while the first reader is waiting.
 *
 * The result is discarded: `listProjects` fills the parsed-model cache as a side effect, so the
 * project list and the first render of any catalog model find their model already compiled. It is
 * deliberately not awaited — a slow or broken catalog must never delay or fail the server, and a
 * reader who asks for a model before the warm-up finishes simply shares the parse already in
 * flight. A catalog that cannot be read is reported once here and again, in full, by the request
 * that needs it.
 */
listProjects().catch((error) => {
  console.warn(
    `Fractal could not warm the model cache: ${error instanceof Error ? error.message : String(error)}`
  );
});
