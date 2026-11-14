import type { CellBuffer, GridLayer } from "@foundry2d/core";
import type { LayerRenderer } from "@foundry2d/render";
import type { Level, LevelProject } from "../model/LevelProject";
import { defUidOf } from "../model/LevelProject";
import { entityRect, fieldValue } from "../model/entities";
import { tileSourceRect } from "../model/tiles";
import type { EntityDef, EntityInstance } from "../model/types";
import { tileLayerRendererFor } from "./tileLayerRenderer";

/** Screen pixels per world unit for the current transform. */
const screenScale = (ctx: CanvasRenderingContext2D) => Math.abs(ctx.getTransform().a) || 1;

/**
 * Display colour of an instance: the colour of its first set Enum value
 * (so a "Ghost" with kind "blinky" shows red), otherwise the def colour.
 */
export function entityColor(project: LevelProject, def: EntityDef, instance: EntityInstance) {
  for (const field of def.fields) {
    if (field.type !== "Enum") continue;
    const value = fieldValue(instance, field, project.defs.enums);
    const color = project.getEnum(field.enumUid)?.values.find((v) => v.id === value)?.color;
    if (color) return color;
  }
  return def.color;
}

/**
 * Label candidates, longest first: identifier plus Enum values
 * ("Ghost blinky"), then the Enum values alone ("blinky").
 */
export function entityLabels(
  project: LevelProject,
  def: EntityDef,
  instance: EntityInstance
): string[] {
  const values: string[] = [];
  for (const field of def.fields) {
    if (field.type !== "Enum") continue;
    const value = fieldValue(instance, field, project.defs.enums);
    if (typeof value === "string") values.push(value);
  }
  return values.length
    ? [[def.identifier, ...values].join(" "), values.join(" ")]
    : [def.identifier];
}

/**
 * Draws one entity in level pixel space, offset by `originX/originY`
 * (the level's position in world units).
 */
export function drawEntity(
  ctx: CanvasRenderingContext2D,
  project: LevelProject,
  def: EntityDef,
  instance: EntityInstance,
  originX: number,
  originY: number,
  options: { labels?: boolean } = {}
): void {
  const scale = screenScale(ctx);
  const px = 1 / scale;
  const box = entityRect(def, instance);
  const x = originX + box.x;
  const y = originY + box.y;
  const color = entityColor(project, def, instance);

  const tileset = def.shape === "tile" && def.tile ? project.getTileset(def.tile.tilesetUid) : null;
  const image = tileset ? project.getTilesetImage(tileset) : undefined;
  const src = tileset && def.tile ? tileSourceRect(tileset, def.tile.tileId) : null;

  if (image && src) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, src.x, src.y, src.width, src.height, x, y, box.width, box.height);
  } else {
    const alpha = ctx.globalAlpha;
    ctx.beginPath();
    if (def.shape === "ellipse") {
      ctx.ellipse(x + box.width / 2, y + box.height / 2, box.width / 2, box.height / 2, 0, 0, 7);
    } else {
      ctx.rect(x, y, box.width, box.height);
    }
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(px, Math.min(2 * px, box.width / 8));
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  // Pivot dot, once the entity is big enough on screen to read.
  const screenW = box.width * scale;
  if (screenW >= 12) {
    ctx.fillStyle = "#ffffff";
    const r = 1.5 * px;
    ctx.fillRect(originX + instance.x - r, originY + instance.y - r, r * 2, r * 2);
  }

  if (options.labels !== false && screenW >= 20) {
    const fontSize = 10 * px;
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.textAlign = "center";
    // Use the longest label that fits over the entity, so neighbours don't overlap.
    const room = box.width + 12 * px;
    const text = entityLabels(project, def, instance).find(
      (label) => ctx.measureText(label).width <= room
    );
    if (!text) return;
    const tx = x + box.width / 2;
    const ty = y - 2 * px;
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    ctx.strokeText(text, tx, ty);
    ctx.fillStyle = "#f4f4f5";
    ctx.fillText(text, tx, ty);
    ctx.textAlign = "start";
  }
}

/** Renderer for an Entities layer of `level`; `dest` is the level rectangle. */
export function entityLayerRenderer(
  project: LevelProject,
  level: Level,
  layerUid: number,
  options: { labels?: boolean } = {}
): LayerRenderer {
  return (ctx, _layer, dest) => {
    for (const instance of level.entities) {
      if (instance.layerUid !== layerUid) continue;
      const def = project.getEntityDef(instance.defUid);
      if (def) drawEntity(ctx, project, def, instance, dest.x, dest.y, options);
    }
  };
}

/**
 * Custom renderers for a level's layers: tiles for Tiles layers, shapes for
 * Entities layers, and `undefined` (the default bitmap path) for IntGrid.
 */
export function levelLayerRendererFor(
  project: LevelProject,
  options: { labels?: boolean } = {}
): (layer: GridLayer<CellBuffer>, level: Level) => LayerRenderer | undefined {
  const tiles = tileLayerRendererFor(project);
  return (layer, level) => {
    const def = project.getLayerDefForLayer(layer.id);
    if (def?.type === "Entities") {
      return entityLayerRenderer(project, level, defUidOf(layer.id)!, options);
    }
    return tiles(layer, level);
  };
}
