import type { ICommand } from "@foundry2d/core";
import type { DefinitionSnapshot, Level, LevelProject } from "./LevelProject";

/**
 * Undoable world edits. Commands hold the `Level` objects themselves, so
 * cell edits recorded on a level stay valid if it is removed and restored.
 */

export class AddLevelCommand implements ICommand {
  readonly label: string;

  constructor(
    private readonly project: LevelProject,
    private readonly level: Level,
    private readonly index = project.levels.length
  ) {
    this.label = `Add level ${level.identifier}`;
  }

  execute(): void {
    this.project.insertLevel(this.level, this.index);
  }

  undo(): void {
    this.project.removeLevel(this.level.uid);
  }
}

export class RemoveLevelCommand implements ICommand {
  readonly label: string;
  private index = -1;

  constructor(
    private readonly project: LevelProject,
    private readonly level: Level
  ) {
    this.label = `Delete level ${level.identifier}`;
  }

  /** False when the project refused (it was the last level). */
  get succeeded(): boolean {
    return this.index !== -1;
  }

  execute(): void {
    this.index = this.project.removeLevel(this.level.uid);
  }

  undo(): void {
    if (this.index !== -1) this.project.insertLevel(this.level, this.index);
  }
}

export class MoveLevelCommand implements ICommand {
  readonly label = "Move level";

  constructor(
    private readonly project: LevelProject,
    private readonly uid: number,
    private readonly from: { x: number; y: number },
    private readonly to: { x: number; y: number }
  ) {}

  execute(): void {
    this.project.moveLevel(this.uid, this.to.x, this.to.y);
  }

  undo(): void {
    this.project.moveLevel(this.uid, this.from.x, this.from.y);
  }
}

export class ReorderLevelCommand implements ICommand {
  readonly label = "Reorder levels";

  constructor(
    private readonly project: LevelProject,
    private readonly from: number,
    private readonly to: number
  ) {}

  execute(): void {
    this.project.reorderLevel(this.from, this.to);
  }

  undo(): void {
    this.project.reorderLevel(this.to, this.from);
  }
}

export class RenameLevelCommand implements ICommand {
  readonly label = "Rename level";
  private previous: string;

  constructor(
    private readonly project: LevelProject,
    private readonly level: Level,
    private readonly identifier: string
  ) {
    this.previous = level.identifier;
  }

  execute(): void {
    this.previous = this.level.identifier;
    this.project.renameLevel(this.level.uid, this.identifier);
  }

  undo(): void {
    this.project.renameLevel(this.level.uid, this.previous);
  }
}

/**
 * A definition edit (layers, values, tilesets, entities, enums, rules, grid
 * size) as one undo step: restores the snapshot taken before or after it.
 * `after` is replaced when rapid repeats of the same edit are merged.
 */
export class DefinitionEditCommand implements ICommand {
  constructor(
    private readonly project: LevelProject,
    readonly label: string,
    private readonly before: DefinitionSnapshot,
    public after: DefinitionSnapshot
  ) {}

  execute(): void {
    this.project.restoreDefinitions(this.after);
  }

  undo(): void {
    this.project.restoreDefinitions(this.before);
  }
}
