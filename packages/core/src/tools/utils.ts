import type { ToolContext } from "./types";
import type { GridDocument } from "../document";
import type { HistoryManager } from "../history";

export function buildToolContext<Buffer extends Uint32Array | Int32Array = Uint32Array>(
  isDrawing: boolean,
  size: number,
  activeColor: number,
  onPickValue: ToolContext<Buffer>["onPickValue"],
  documentManager: GridDocument<Buffer>,
  historyManager: HistoryManager
): ToolContext<Buffer> {
  // return {
  //   doc,
  //   layer: doc.getActiveLayer()!,
  //   history,
  //   value: activeColorInt,
  //   size: 1,
  //   isDrawing,
  //   onPickValue: (pickedInt) => {
  //     activeColorInt = pickedInt;
  //     // Convert int to hex to update the UI color-picker button:
  //     const hex = ColorUtils.rgbaIntToHex(pickedInt);
  //     colorPickerButton.setAttribute("value", hex);
  //     // Auto return to previous pen/brush tool:
  //     toolManager.returnToPreviousTool();
  //   },
  // };
  return {
    doc: documentManager,
    layer: documentManager.getActiveLayer()!,
    history: historyManager,
    value: activeColor,
    size,
    isDrawing,
    onPickValue,
  };
}
