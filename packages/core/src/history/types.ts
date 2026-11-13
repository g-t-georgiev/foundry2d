export interface ICommand {
  /** Optional human readable label, e.g. for an undo history panel. */
  readonly label?: string;
  execute(): void;
  undo(): void;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}
