/**
 * Phase 0 smoke entry: proves the shared Workspace kit end to end.
 * Phase 1 replaces this with the full Application/UIManager wiring.
 */
import { GridDocument, HistoryManager, PixelUtils, ToolManager } from "@foundry2d/core";
import { GridDocumentScene, Workspace } from "@foundry2d/workspace";

import "@foundry2d/ui";
import type { LayersManager } from "@foundry2d/ui";

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = document.querySelector<HTMLCanvasElement>("#paintCanvas")!;
const layerManager = document.querySelector<LayersManager>("layers-manager")!;

const doc = new GridDocument<Uint32Array>({
  width: 32,
  height: 32,
  emptyValue: 0x00000000,
  bufferCtor: Uint32Array,
});
const history = new HistoryManager();
const tools = new ToolManager<Uint32Array>();

const background = doc.addLayer("Background");
doc.addLayer({ name: "Character", activate: true });
layerManager.addNewLayer({ id: background.id, name: background.name, visible: true });
const active = doc.getActiveLayer()!;
layerManager.addNewLayer({ id: active.id, name: active.name, active: true, visible: true });

let color = PixelUtils.hexToUint32("#ffee00");
let brushSize = 1;
let preview = false;
let showGrid = true;

const scene = new GridDocumentScene<Uint32Array>({
  doc,
  tools,
  history,
  getValue: () => color,
  getBrushSize: () => brushSize,
  getCursorFill: () => `${PixelUtils.uint32ToHex(color)}66`,
  onPickValue: (value) => {
    if (value >>> 24 !== 0) color = value;
    tools.returnToPreviousTool();
  },
  isPreview: () => preview,
  showGrid: () => showGrid,
  majorGridEvery: 8,
});

const workspace = new Workspace(viewport, { canvas });
void workspace.setScene(scene);

layerManager.addEventListener("layer:selected", (ev) => doc.setActiveLayer(ev.detail.id));
layerManager.addEventListener("layer:visibility-change", (ev) =>
  doc.setLayerProperty(ev.detail.id, "visible", ev.detail.visible)
);

const { keymap } = workspace;
keymap.bind("mod+z", () => void history.undo(), { repeat: true });
keymap.bind("mod+shift+z", () => void history.redo(), { repeat: true });
keymap.bind("mod+y", () => void history.redo(), { repeat: true });
keymap.bind("b", () => void tools.setTool("pen"));
keymap.bind("e", () => void tools.setTool("eraser"));
keymap.bind("g", () => void tools.setTool("bucket"));
keymap.bind("i", () => void tools.setTool("eyedropper"));
keymap.bind("[", () => {
  brushSize = Math.max(1, brushSize - 1);
  scene.invalidate();
});
keymap.bind("]", () => {
  brushSize = Math.min(32, brushSize + 1);
  scene.invalidate();
});
keymap.bind("#", () => {
  showGrid = !showGrid;
  scene.invalidate();
});
keymap.bind("p", () => {
  preview = !preview;
  scene.invalidate();
});
keymap.bind("f", () => void workspace.fitToView(200));
keymap.bind("+", () => workspace.zoomBy(1.25), { repeat: true });
keymap.bind("-", () => workspace.zoomBy(0.8), { repeat: true });
keymap.hold(
  "alt",
  () => tools.setTool("eyedropper"),
  () => tools.returnToPreviousTool()
);

// Handy for poking at the kit from devtools during Phase 0.
Object.assign(window, { foundry: { doc, history, tools, workspace, scene } });
