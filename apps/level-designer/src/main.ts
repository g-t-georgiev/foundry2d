/**
 * Phase 0 smoke entry: an IntGrid (Int32Array) level rendered through the
 * shared Workspace kit with a value palette. Phase 2 replaces this with the
 * project model, panels and world view.
 */
import { GridDocument, HistoryManager, PixelUtils, ToolManager } from "@foundry2d/core";
import { GridDocumentScene, Workspace } from "@foundry2d/workspace";

import "@foundry2d/ui";
import { LayerPanelEvents } from "@foundry2d/ui";

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = document.querySelector<HTMLCanvasElement>("#levelCanvas")!;
const layersPanel = document.querySelector("layers-panel")!;

const TILE = 8;

/** Pac-Man collision values (from the old level editor's layersData). */
const collisionValues = [
  { value: 1, label: "Wall", color: "#1919a3" },
  { value: 2, label: "Intersection A", color: "#47a400" },
  { value: 3, label: "Intersection B", color: "#a69801" },
  { value: 4, label: "Ghost House Door", color: "#fcb9f8" },
  { value: 5, label: "Tunnel Entry", color: "#ffffff" },
];
const palette = new Map(collisionValues.map((v) => [v.value, PixelUtils.hexToUint32(v.color)]));

const doc = new GridDocument<Int32Array>({
  width: 28,
  height: 36,
  emptyValue: 0,
  bufferCtor: Int32Array,
});
const history = new HistoryManager();
const tools = new ToolManager<Int32Array>();

doc.addLayer("Collisions");
doc.addLayer("Collectibles");

let value = 1;

const scene = new GridDocumentScene<Int32Array>({
  doc,
  tools,
  history,
  cellSize: { width: TILE, height: TILE },
  getValue: () => value,
  colorize: (v) => palette.get(v) ?? 0,
  getCursorFill: () => `${collisionValues.find((v) => v.value === value)?.color ?? "#ffffff"}88`,
  onPickValue: (picked) => {
    if (picked !== 0) value = picked;
    tools.returnToPreviousTool();
  },
  majorGridEvery: 4,
});

const workspace = new Workspace(viewport, {
  canvas,
  rulers: { unitScale: () => TILE, unitLabel: () => "t" },
  theme: { workspaceBackground: "#0e0e11" },
});
void workspace.setScene(scene);

// Phase 2 replaces this with layer definitions and undoable commands.
const syncLayers = () => {
  layersPanel.layers = doc.layers.map(({ id, name, visible, opacity }) => ({
    id,
    name,
    visible,
    opacity,
  }));
  layersPanel.activeId = doc.activeLayerId;
};
doc.events.on("layers:changed", syncLayers);
doc.events.on("layer:updated", syncLayers);
doc.events.on("layer:activated", syncLayers);
syncLayers();

layersPanel.addEventListener(LayerPanelEvents.Select, (ev) => doc.setActiveLayer(ev.detail.id));
layersPanel.addEventListener(LayerPanelEvents.Visibility, (ev) =>
  doc.setLayerProperty(ev.detail.id, "visible", ev.detail.visible)
);
layersPanel.addEventListener(LayerPanelEvents.Opacity, (ev) =>
  doc.setLayerProperty(ev.detail.id, "opacity", ev.detail.opacity)
);

const { keymap } = workspace;
keymap.bind("mod+z", () => void history.undo(), { repeat: true });
keymap.bind("mod+shift+z", () => void history.redo(), { repeat: true });
keymap.bind("b", () => void tools.setTool("pen"));
keymap.bind("e", () => void tools.setTool("eraser"));
keymap.bind("g", () => void tools.setTool("bucket"));
keymap.bind("f", () => void workspace.fitToView(200));
for (const { value: v } of collisionValues) {
  keymap.bind(String(v), () => {
    value = v;
    scene.invalidate();
  });
}

Object.assign(window, { foundry: { doc, history, tools, workspace, scene } });
