import type { HistoryManager } from "@foundry2d/core";
import type { Level, LevelProject } from "../model/LevelProject";
import {
  AddLevelCommand,
  RemoveLevelCommand,
  RenameLevelCommand,
  ReorderLevelCommand,
} from "../model/commands";

export interface LevelOperationsHooks {
  getProject(): LevelProject;
  /** The level open in the level view. */
  getOpenLevel(): Level;
  /** The level selected in the world (or levels list), if any. */
  getSelectedLevel(): Level | undefined;
  /** Selects a level; `reveal` pans the world view to it. */
  select(uid: number | null, reveal: boolean): void;
  history: HistoryManager;
  notify(message: string, timeout?: number): void;
}

/**
 * World edits as undo steps: add, duplicate, delete, reorder and rename
 * levels. Used by the world view, the levels list and key bindings.
 */
export class LevelOperations {
  constructor(private readonly hooks: LevelOperationsHooks) {}

  private get project(): LevelProject {
    return this.hooks.getProject();
  }

  /** Adds a level the size of the selected one, at `x, y` or the next free spot. */
  add(x?: number, y?: number): void {
    const { project, hooks } = this;
    const template = hooks.getSelectedLevel() ?? hooks.getOpenLevel();
    const position =
      x !== undefined && y !== undefined ? project.snapPosition(x, y) : project.nextFreePosition();
    const level = project.createLevel("level_0", template.width, template.height, {
      worldX: position.x,
      worldY: position.y,
    });
    // Start on the same layer the user was working on.
    level.doc.setActiveLayer(template.doc.activeLayerId);
    // createLevel already inserted it; record the step for undo/redo.
    hooks.history.record(new AddLevelCommand(project, level, project.indexOfLevel(level.uid)));
    hooks.select(level.uid, x === undefined);
    hooks.notify(`Added ${level.identifier}`);
  }

  duplicate(uid: number): void {
    const { project, hooks } = this;
    const source = project.getLevel(uid);
    if (!source) return;
    const rect = source.worldRect(project.gridSize);
    const position = project.snapPosition(rect.x + rect.width + project.gridSize * 2, rect.y);
    const copy = project.cloneLevel(uid, position.x, position.y);
    if (!copy) return;
    hooks.history.execute(new AddLevelCommand(project, copy, project.indexOfLevel(uid) + 1));
    hooks.select(copy.uid, true);
    hooks.notify(`Duplicated ${source.identifier}`);
  }

  remove(uid: number): void {
    const { project, hooks } = this;
    const level = project.getLevel(uid);
    if (!level) return;
    if (project.levels.length <= 1) {
      hooks.notify("A project needs at least one level.", 3000);
      return;
    }
    const index = project.indexOfLevel(uid);
    const command = new RemoveLevelCommand(project, level);
    command.execute();
    if (!command.succeeded) return;
    hooks.history.record(command);
    const next = project.levels[Math.min(index, project.levels.length - 1)];
    hooks.select(next?.uid ?? null, false);
    hooks.notify(`Deleted ${level.identifier} (Ctrl+Z to undo)`, 3500);
  }

  reorder(uid: number, direction: "up" | "down"): void {
    const from = this.project.indexOfLevel(uid);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= this.project.levels.length) return;
    this.hooks.history.execute(new ReorderLevelCommand(this.project, from, to));
  }

  rename(uid: number, identifier: string): void {
    const level = this.project.getLevel(uid);
    if (!level || !identifier.trim() || identifier.trim() === level.identifier) return;
    this.hooks.history.execute(new RenameLevelCommand(this.project, level, identifier));
  }
}
