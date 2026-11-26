import {
  AddLayerCommand,
  CompositeCommand,
  DeleteLayerCommand,
  MoveLayerCommand,
  ResizeCommand,
  SetLayerPropertyCommand,
  type EditableLayerProperties,
  type GridLayer,
  type ICommand,
} from "@gs2d/core";
import type { Frame, Sprite } from "./Sprite";

/**
 * Sprite-wide commands. Layer structure is shared by all frames, so every
 * layer edit is a composite of the core command applied to each frame's
 * document; undo then restores all frames together.
 */

export function addLayerToAllFrames(sprite: Sprite, afterId: string | null): ICommand {
  const id = sprite.nextLayerId();
  const doc = sprite.doc;
  const index = afterId ? doc.indexOfLayer(afterId) + 1 : doc.layers.length;
  const name = `Layer ${doc.layers.length + 1}`;
  return new CompositeCommand(
    sprite.frames.map((f) => new AddLayerCommand(f.doc, { id, name, index })),
    "Add layer"
  );
}

export function duplicateLayerInAllFrames(sprite: Sprite, sourceId: string): ICommand | null {
  const source = sprite.doc.getLayer(sourceId);
  if (!source) return null;
  const id = sprite.nextLayerId();
  const index = sprite.doc.indexOfLayer(sourceId) + 1;
  return new CompositeCommand(
    sprite.frames.map((f) => {
      const layer = f.doc.getLayer(sourceId);
      return new AddLayerCommand(f.doc, {
        id,
        name: `${source.name} copy`,
        index,
        visible: source.visible,
        opacity: source.opacity,
        data: layer?.data,
      });
    }),
    "Duplicate layer"
  );
}

export function deleteLayerFromAllFrames(sprite: Sprite, id: string): ICommand | null {
  if (!sprite.doc.getPolicy(id).canDelete) return null;
  return new CompositeCommand(
    sprite.frames.map((f) => new DeleteLayerCommand(f.doc, id)),
    "Delete layer"
  );
}

export function moveLayerInAllFrames(
  sprite: Sprite,
  id: string,
  direction: "up" | "down"
): ICommand | null {
  const from = sprite.doc.indexOfLayer(id);
  const to = direction === "up" ? from + 1 : from - 1;
  if (from === -1 || to < 0 || to >= sprite.doc.layers.length) return null;
  return new CompositeCommand(
    sprite.frames.map((f) => new MoveLayerCommand(f.doc, from, to)),
    "Reorder layers"
  );
}

export function setLayerPropertyInAllFrames<K extends EditableLayerProperties>(
  sprite: Sprite,
  id: string,
  property: K,
  value: GridLayer<Uint32Array>[K],
  previous?: GridLayer<Uint32Array>[K]
): ICommand {
  return new CompositeCommand(
    sprite.frames.map((f) => new SetLayerPropertyCommand(f.doc, id, property, value, previous)),
    `Change layer ${property}`
  );
}

export function resizeAllFrames(sprite: Sprite, width: number, height: number): ICommand {
  return new CompositeCommand(
    sprite.frames.map((f) => new ResizeCommand(f.doc, { width, height })),
    "Resize"
  );
}

export class AddFrameCommand implements ICommand {
  readonly label: string;

  constructor(
    private readonly sprite: Sprite,
    private readonly frame: Frame,
    private readonly index: number,
    label = "Add frame"
  ) {
    this.label = label;
  }

  execute(): void {
    this.sprite.insertFrame(this.frame, this.index);
  }

  undo(): void {
    const index = this.sprite.frames.indexOf(this.frame);
    if (index !== -1) this.sprite.removeFrame(index);
  }
}

export class RemoveFrameCommand implements ICommand {
  readonly label = "Delete frame";
  private removed: Frame | null = null;

  constructor(
    private readonly sprite: Sprite,
    private readonly index: number
  ) {}

  get succeeded(): boolean {
    return this.removed !== null;
  }

  execute(): void {
    this.removed = this.sprite.removeFrame(this.index);
  }

  undo(): void {
    if (this.removed) this.sprite.insertFrame(this.removed, this.index);
  }
}

export class MoveFrameCommand implements ICommand {
  readonly label = "Move frame";

  constructor(
    private readonly sprite: Sprite,
    private readonly from: number,
    private readonly to: number
  ) {}

  execute(): void {
    this.sprite.moveFrame(this.from, this.to);
  }

  undo(): void {
    this.sprite.moveFrame(this.to, this.from);
  }
}

export class SetFrameDurationCommand implements ICommand {
  readonly label = "Frame duration";
  private previous: number | null = null;

  constructor(
    private readonly sprite: Sprite,
    private readonly frame: Frame,
    private readonly duration: number | null
  ) {}

  execute(): void {
    this.previous = this.frame.duration;
    this.sprite.setFrameDuration(this.sprite.frames.indexOf(this.frame), this.duration);
  }

  undo(): void {
    this.sprite.setFrameDuration(this.sprite.frames.indexOf(this.frame), this.previous);
  }
}
