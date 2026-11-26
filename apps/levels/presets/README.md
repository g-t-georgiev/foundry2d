# Levels presets

Each `*.gs2dlevel.json` file here is an ordinary level project (the same format
"Save" writes). The editor lists every file in this folder under **New**, so
adding a preset means dropping a file in; no code changes are needed.

The optional `preset` block only affects how the file is listed:

```json
"preset": { "label": "Pac-Man (arcade)", "description": "…", "order": 0 }
```

To make a new preset, build the project in the editor, use **Save as**, copy
the file here, and add a `preset` block.

Presets keep the `.gs2dlevel.json` name (not the `.gs2dlevel` that **Save**
writes) because the build imports them as JSON modules, which need a
`.json` extension. Rename a saved `.gs2dlevel` file to `.gs2dlevel.json` when
copying it here.
