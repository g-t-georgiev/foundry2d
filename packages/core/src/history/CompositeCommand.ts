import type { ICommand } from "./types";

/** Groups several commands into one undo step. Undo runs in reverse order. */
export class CompositeCommand implements ICommand {
  constructor(
    private readonly commands: ICommand[],
    public readonly label?: string
  ) {}

  get isEmpty(): boolean {
    return this.commands.length === 0;
  }

  execute(): void {
    for (const cmd of this.commands) cmd.execute();
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo();
  }
}
