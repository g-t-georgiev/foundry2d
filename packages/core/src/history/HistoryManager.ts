import type { ICommand } from "./types";

export class HistoryManager {
  private undoStack: ICommand[] = [];
  private redoStack: ICommand[] = [];

  record(command: ICommand) {
    this.undoStack.push(command);
    this.redoStack = [];
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this.undoStack.push(cmd);
  }
}
