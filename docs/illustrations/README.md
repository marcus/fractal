# Studio screenshot

`studio.png` is an unmodified browser screenshot of Fractal's own architecture in the Midnight
theme. It shows the pipeline perspective focused on `core`, with `core` expanded and the
navigation visible. The source model is [`docs/diagrams/fractal`](../diagrams/fractal).

To reproduce, register that model as `fractal`, open the studio with `model=fractal` and
`scene=pipeline`, and add a URL-encoded `view` containing:

```json
{
  "expanded": ["core"],
  "scope": "core",
  "proposed": false,
  "lens": "structure",
  "theme": "midnight"
}
```

Let fonts and layout finish, then capture the studio viewport. Keep private catalog entries,
source paths and other projects out of public screenshots.
