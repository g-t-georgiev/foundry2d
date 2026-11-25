import type { ICommand, HistoryState } from "./types";
import type { Unsubscribe } from "../utils/EventEmitter";

export interface HistoryOptions {
  /** Maximum number of undo steps kept. Defaults to 200. */
  limit?: number;
}

export type HistoryListener = (state: HistoryState) => void;

export class HistoryManager {
  private undoStack: ICommand[] = [];
  private redoStack: ICommand[] = [];
  private listeners = new Set<HistoryListener>();
  private readonly limit: number;

  constructor(options: HistoryOptions = {}) {
    this.limit = Math.max(1, options.limit ?? 200);
  }

  /** Records a command whose effect has already been applied (e.g. a finished pen stroke). */
  record(command: ICommand): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  /** Executes a command and records it. */
  execute(command: ICommand): void {
    command.execute();
    this.record(command);
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    this.notify();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getState(): HistoryState {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.undoStack.at(-1)?.label,
      redoLabel: this.redoStack.at(-1)?.label,
    };
  }

  onChange(listener: HistoryListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}
