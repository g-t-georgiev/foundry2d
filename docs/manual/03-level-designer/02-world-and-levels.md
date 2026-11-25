# World and levels

## The world view

Every level is drawn at its place in the world, with its name. The world has no edges: pan and zoom as far as you like.

- **Click** a level to select it; **drag** it to move it.
- **Double-click** a level, or press **Enter**, to open it (the view zooms into it). **Esc** goes back.
- **Double-click empty space** to create a level there.
- **Delete** removes the selected level and **Ctrl+D** duplicates it.

Moves, creations, duplicates and deletions are undo steps.

## World layouts

**World → Layout** decides how levels are placed:

- **Free:** anywhere; moves snap to the level grid.
- **GridVania:** levels snap to a world grid, whose cell size is set in **World cell W** and **H**. Good for Metroidvania-style maps where rooms share edges.
- **Linear · horizontal** and **Linear · vertical:** levels sit in a row or a column, in list order; reorder the list to move them.

## The Levels list

The list shows the levels in order. The buttons above it:

- **+** adds a level, **⧉** duplicates the selected one (Ctrl+D);
- **⤓** imports a level from game JSON (see [Exporting and importing](07-exporting.md));
- **↑** and **↓** move it in the list (which matters for the linear layouts and for games that read levels in order);
- **✕** deletes it.

Double-click a name or press **F2** to rename; **Open selected level** opens it.

## A level's properties

In the level view, the **Level** section shows:

- **Name** and **Size** (in cells).
- **Background:** the colour under the layers; **Default** switches back to the project's default (Project settings → Levels).
- **Level fields:** values for the fields every level has, if the project defines some (see [Entities, fields and enums](06-entities.md)).
- **Resize edges:** cells to add (positive) or remove (negative) on each side, then **Apply resize**. Growing on the left or top keeps the content where it is in the world, and entities and their points move with the content. Undo restores everything, including cropped cells.
