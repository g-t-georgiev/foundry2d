import { decodeTile } from "../model/tiles";
import type Application from "../Application";

const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;

/**
 * Status bar readouts: the cell or world position under the pointer, what
 * is there (value, tile, entity or level), and the zoom.
 */
export function bindStatusBar(app: Application): void {
  const cell = $("#statCell");
  const value = $("#statValue");
  app.workspace.events.on("pointer:move", ({ grid, world, inside }) => {
    if (app.view === "world") {
      const level = inside ? app.project.levelAt(world.x, world.y) : undefined;
      cell.textContent = inside ? `${Math.floor(world.x)}, ${Math.floor(world.y)} px` : "—";
      value.textContent = level ? level.identifier : "—";
      return;
    }
    const { doc } = app.level;
    const onLevel =
      inside && grid.x >= 0 && grid.y >= 0 && grid.x < doc.width && grid.y < doc.height;
    if (!onLevel) {
      cell.textContent = "—";
      value.textContent = "—";
      return;
    }
    cell.textContent = `${grid.x}, ${grid.y}`;
    if (app.entities.isActive) {
      const hit = app.entities.hitTest(world);
      const def = hit ? app.project.getEntityDef(hit.defUid) : undefined;
      value.textContent = def && hit ? `${def.identifier} @ ${hit.x}, ${hit.y} px` : "—";
      return;
    }
    const layer = doc.getActiveLayer();
    const v = layer?.get(grid.x, grid.y) ?? 0;
    const def = layer ? app.project.getLayerDefForLayer(layer.id) : undefined;
    if (def?.type === "Tiles") {
      const tile = decodeTile(v);
      const auto = app.project.isAutoLayer(def) ? " (auto)" : "";
      value.textContent = tile
        ? `tile #${tile.tileId}${tile.flipX ? " ↔" : ""}${tile.flipY ? " ↕" : ""}${auto}`
        : `empty${auto}`;
      return;
    }
    value.textContent =
      v === 0
        ? "empty"
        : `${def?.intGridValues.find((e) => e.value === v)?.identifier ?? "?"} (${v})`;
  });
  const zoom = (z: number) => {
    const text = `${Math.round(z * 100)}%`;
    $("#statZoom").textContent = text;
    $("#zoomHud").textContent = text;
  };
  app.workspace.events.on("camera:changed", ({ zoom: z }) => zoom(z));
  zoom(app.workspace.zoom);
}
