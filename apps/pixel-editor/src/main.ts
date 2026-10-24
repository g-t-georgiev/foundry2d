import { GridDocument, Camera, HistoryManager, DrawCommand } from "@foundry2d/core";

import "@foundry2d/ui";
import type { LayersManager } from "@foundry2d/ui";

const canvas = document.querySelector<HTMLCanvasElement>("#paintCanvas")!;
const context = canvas.getContext("2d")!;

const layerManager = document.querySelector<LayersManager>("layers-manager")!;

// Pixel Art Model: 16x16 with Uint32Array (RGBA 0xAABBGGRR)
const doc = new GridDocument({
  width: 16,
  height: 16,
  emptyValue: 0x00000000,
  bufferCtor: Uint32Array,
});

const defaultLayer = doc.addLayer("Base Layer");
layerManager.addNewLayer({
  id: defaultLayer.id,
  name: defaultLayer.name,
  active: true,
  visible: true,
});

const camera = new Camera({ cellSize: { width: 1, height: 1 } });
const history = new HistoryManager();

function resizeCanvas() {
  canvas.width = canvas.clientWidth * window.devicePixelRatio;
  canvas.height = canvas.clientHeight * window.devicePixelRatio;
  camera.x = canvas.width / 2 - (doc.width * camera.zoom) / 2;
  camera.y = canvas.height / 2 - (doc.height * camera.zoom) / 2;
  camera.zoom = 24 * window.devicePixelRatio;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

let isDrawing = false;
let currentStroke: { x: number; y: number; oldValue: number; newValue: number }[] = [];

canvas.addEventListener("pointerdown", (e) => {
  isDrawing = true;
  currentStroke = [];
  drawAt(e);
});

canvas.addEventListener("pointermove", (e) => {
  if (isDrawing) drawAt(e);
});

window.addEventListener("pointerup", () => {
  if (isDrawing && currentStroke.length > 0) {
    history.record(new DrawCommand(doc.getActiveLayer()!, currentStroke));
  }
  isDrawing = false;
});

function drawAt(e: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  const world = camera.screenToWorld(
    e.clientX * window.devicePixelRatio,
    e.clientY * window.devicePixelRatio,
    {
      left: rect.left * window.devicePixelRatio,
      top: rect.top * window.devicePixelRatio,
    } as DOMRect
  );

  const grid = camera.worldToGrid(world.worldX, world.worldY);
  const activeLayer = doc.getActiveLayer();
  if (!activeLayer || !activeLayer.isWithinBounds(grid.x, grid.y)) return;

  const color = 0xffffcc00; // Yellow (ABGR)
  const old = activeLayer.get(grid.x, grid.y);
  if (old !== color) {
    activeLayer.set(grid.x, grid.y, color);
    currentStroke.push({ x: grid.x, y: grid.y, oldValue: old, newValue: color });
  }
}

function render() {
  requestAnimationFrame(render);
  context.fillStyle = "#222";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.translate(camera.x, camera.y);
  context.scale(camera.zoom, camera.zoom);

  const activeLayer = doc.getActiveLayer();
  if (activeLayer) {
    for (let y = 0; y < activeLayer.height; y++) {
      for (let x = 0; x < activeLayer.width; x++) {
        const val = activeLayer.get(x, y);
        if (val !== 0) {
          context.fillStyle = "#ffcc00";
          context.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  context.strokeStyle = "rgba(255,255,255,0.2)";
  context.lineWidth = 1 / camera.zoom;
  context.strokeRect(0, 0, doc.width, doc.height);
  context.restore();
}
render();
