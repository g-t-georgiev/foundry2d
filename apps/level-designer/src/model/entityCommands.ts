import type { ICommand } from "@foundry2d/core";
import type { Level, LevelProject } from "./LevelProject";
import type { EntityInstance } from "./types";
import { cloneInstance } from "./entities";

/**
 * Undoable entity edits. Like the level commands they hold the `Level`
 * itself, so they stay valid while the level is open elsewhere or deleted
 * and restored.
 */

export class AddEntityCommand implements ICommand {
  readonly label = "Add entity";
  private readonly instance: EntityInstance;

  constructor(
    private readonly project: LevelProject,
    private readonly level: Level,
    instance: EntityInstance,
    private readonly index = level.entities.length
  ) {
    this.instance = cloneInstance(instance);
  }

  execute(): void {
    this.project.insertEntity(this.level, cloneInstance(this.instance), this.index);
  }

  undo(): void {
    this.project.removeEntity(this.level, this.instance.iid);
  }
}

export class RemoveEntityCommand implements ICommand {
  readonly label = "Delete entity";
  private index = -1;
  private readonly snapshot: EntityInstance | null;

  constructor(
    private readonly project: LevelProject,
    private readonly level: Level,
    iid: string
  ) {
    const found = level.entities.find((e) => e.iid === iid);
    this.snapshot = found ? cloneInstance(found) : null;
  }

  execute(): void {
    if (this.snapshot) this.index = this.project.removeEntity(this.level, this.snapshot.iid);
  }

  undo(): void {
    if (this.snapshot && this.index !== -1) {
      this.project.insertEntity(this.level, cloneInstance(this.snapshot), this.index);
    }
  }
}

/** Replaces an instance's state (position and/or fields) from `before` to `after`. */
export class UpdateEntityCommand implements ICommand {
  private readonly before: EntityInstance;
  private readonly after: EntityInstance;

  constructor(
    private readonly project: LevelProject,
    private readonly level: Level,
    before: EntityInstance,
    after: EntityInstance,
    readonly label = "Edit entity"
  ) {
    this.before = cloneInstance(before);
    this.after = cloneInstance(after);
  }

  execute(): void {
    this.project.replaceEntity(this.level, this.after);
  }

  undo(): void {
    this.project.replaceEntity(this.level, this.before);
  }
}

/** Shifts all entities of a level by whole cells (paired with edge resizes). */
export class ShiftEntitiesCommand implements ICommand {
  readonly label = "Shift entities";

  constructor(
    private readonly project: LevelProject,
    private readonly level: Level,
    private readonly cellsX: number,
    private readonly cellsY: number
  ) {}

  execute(): void {
    this.project.shiftEntities(this.level, this.cellsX, this.cellsY);
  }

  undo(): void {
    this.project.shiftEntities(this.level, -this.cellsX, -this.cellsY);
  }
}
