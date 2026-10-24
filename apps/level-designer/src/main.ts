import { GridDocument, Camera, HistoryManager, DrawCommand } from "@foundry2d/core";

import "@foundry2d/ui";
import type { LayersManager } from "@foundry2d/ui";

const canvas = document.querySelector<HTMLCanvasElement>("#levelCanvas")!;
const ctx = canvas.getContext("2d")!;

const layerManager = document.querySelector<LayersManager>("layers-manager")!;

// Tilemap Model: 28x36 Pacman level with Int32Array (Tile IDs, -1 = empty)
const doc = new GridDocument({
  width: 28,
  height: 36,
  emptyValue: -1,
  bufferCtor: Int32Array,
});

const groundLayer = doc.addLayer("Tilemap Layer");
const collisionLayer = doc.addLayer("Collisions");

layerManager.addNewLayer({
  id: groundLayer.id,
  name: groundLayer.name,
  active: true,
});
layerManager.addNewLayer({
  id: collisionLayer.id,
  name: collisionLayer.name,
});

// Camera configured with 16x16 px tiles
const camera = new Camera({ cellSize: { width: 16, height: 16 } });
const history = new HistoryManager();

function resize() {
  canvas.width = canvas.clientWidth * window.devicePixelRatio;
  canvas.height = canvas.clientHeight * window.devicePixelRatio;
  camera.x = canvas.width / 2 - (doc.width * 16 * camera.zoom) / 2;
  camera.y = canvas.height / 2 - (doc.height * 16 * camera.zoom) / 2;
  camera.zoom = 1.5 * window.devicePixelRatio;
}
window.addEventListener("resize", resize);
resize();

let isPlacing = false;
let currentChanges: { x: number; y: number; oldValue: number; newValue: number }[] = [];

canvas.addEventListener("pointerdown", (e) => {
  isPlacing = true;
  currentChanges = [];
  placeTile(e);
});

canvas.addEventListener("pointermove", (e) => {
  if (isPlacing) placeTile(e);
});

window.addEventListener("pointerup", () => {
  if (isPlacing && currentChanges.length > 0) {
    history.record(new DrawCommand(doc.getActiveLayer()!, currentChanges));
  }
  isPlacing = false;
});

function placeTile(e: PointerEvent) {
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

  const tileId = 1; // Wall tile ID
  const old = activeLayer.get(grid.x, grid.y);
  if (old !== tileId) {
    activeLayer.set(grid.x, grid.y, tileId);
    currentChanges.push({ x: grid.x, y: grid.y, oldValue: old, newValue: tileId });
  }
}

function render() {
  requestAnimationFrame(render);
  ctx.fillStyle = "#0e0e11";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const activeLayer = doc.getActiveLayer();
  if (activeLayer) {
    for (let y = 0; y < activeLayer.height; y++) {
      for (let x = 0; x < activeLayer.width; x++) {
        const tile = activeLayer.get(x, y);
        if (tile !== -1) {
          ctx.fillStyle = "#2563eb";
          ctx.fillRect(x * 16, y * 16, 16, 16);
        }
        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.strokeRect(x * 16, y * 16, 16, 16);
      }
    }
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1 / camera.zoom;
  ctx.strokeRect(0, 0, doc.width * 16, doc.height * 16);
  ctx.restore();
}
render();
