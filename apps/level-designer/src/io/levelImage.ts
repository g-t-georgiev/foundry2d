import { LayerBitmapCache } from "@foundry2d/render";
import type { Level, LevelProject } from "../model/LevelProject";
import { levelLayerRendererFor } from "../render/entityRenderer";

/**
 * Resolves once every tileset image used by the project has decoded (or
 * after `timeout` ms), so exports never miss tiles that are still loading.
 */
export async function waitForTilesets(project: LevelProject, timeout = 4000): Promise<void> {
  const pending = () => project.defs.tilesets.some((t) => !project.getTilesetImage(t));
  if (!pending()) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, timeout);
    const off = project.events.on("tilesets:loaded", () => {
      if (!pending()) done();
    });
    function done() {
      clearTimeout(timer);
      off();
      resolve();
    }
  });
}

export interface LevelImageOptions {
  /** Only this document layer (drawn even if hidden, at full opacity). */
  layerId?: string;
  /** Output pixels per level pixel (default 1: one cell = grid size). */
  scale?: number;
}

/**
 * Renders a level to a canvas at native resolution with a transparent
 * background: visible layers at their opacity (or a single layer), tiles
 * from their tilesets, IntGrid layers in their value colours and entities
 * as their shapes or tiles, without editor labels.
 */
export async function renderLevelCanvas(
  project: LevelProject,
  level: Level,
  options: LevelImageOptions = {}
): Promise<HTMLCanvasElement> {
  await waitForTilesets(project);
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const width = level.width * project.gridSize;
  const height = level.height * project.gridSize;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available.");
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const rect = { x: 0, y: 0, width, height };
  const renderers = levelLayerRendererFor(project, { labels: false });
  const cache = new LayerBitmapCache();
  const layers = options.layerId
    ? level.doc.layers.filter((l) => l.id === options.layerId)
    : level.doc.layers.filter((l) => l.visible && l.opacity > 0);
  for (const layer of layers) {
    ctx.globalAlpha = options.layerId ? 1 : layer.opacity;
    const custom = renderers(layer, level);
    if (custom) {
      custom(ctx, layer, rect, rect);
      continue;
    }
    ctx.drawImage(
      cache.get(layer, project.colorizerFor(layer.id), project.paletteVersion),
      0,
      0,
      width,
      height
    );
  }
  cache.clear();
  return canvas;
}

/** PNG of a level (or one layer); see `renderLevelCanvas`. */
export async function renderLevelPng(
  project: LevelProject,
  level: Level,
  options: LevelImageOptions = {}
): Promise<Blob> {
  const canvas = await renderLevelCanvas(project, level, options);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the PNG."))),
      "image/png"
    )
  );
}
