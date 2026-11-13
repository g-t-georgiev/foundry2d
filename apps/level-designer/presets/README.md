# Level Designer presets

Each `*.f2dlevel.json` file here is an ordinary level project (the same format
"Save" writes). The editor lists every file in this folder under **New**, so
adding a preset means dropping a file in; no code changes are needed.

The optional `preset` block only affects how the file is listed:

```json
"preset": { "label": "Pac-Man (arcade)", "description": "…", "order": 0 }
```

To make a new preset, build the project in the editor, click **Save**, copy
the file here, and add a `preset` block.
