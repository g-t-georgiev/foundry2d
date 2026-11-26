# Entities, fields and enums

**Entities** are things placed in a level that aren't part of the grid: the player's start, enemies, coins, doors. Each has a type and **fields**: values the game reads, like a ghost's name or where a door leads.

## Entity types (Project settings → Entities)

**+ Entity** adds a type. Its settings:

- **Identifier:** the name in exports, e.g. `Ghost`.
- **Width** and **Height** in pixels, and **Colour**.
- **Shape:** rectangle, ellipse, or a **tile** from a tileset (picked in the tileset).
- **Pivot:** the point of the entity that sits on its position: a corner, the middle of an edge, or the centre.
- **Max per level** (0 = any): at the limit, placing another one moves the most recent instead, handy for a single player start.
- **Fields:** see below.

## Placing and editing

Make an Entities layer active. The right sidebar shows the entity types and an **Inspector**.

- Choose a type (or press **1–9**), then **click** in the level to place it, snapped to the layer's grid; hold **Shift** to place it freely.
- **Click** an entity to select it, **drag** to move (whole cells, or pixels with **Shift**). The arrow keys nudge it by a cell, **Shift+arrows** by a pixel.
- **Delete**, **Backspace** or a **right-click** removes it; **Ctrl+D** duplicates it; **Alt+click** an entity to choose its type for placing.
- The **Inspector** edits the selected entity's position and field values.

## Fields

Fields are defined per entity type (and for levels, in Project settings → Levels). Each has an identifier, a type, a default and, for numbers, a minimum and maximum. Types:

| Type               | Holds                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Int**, **Float** | Numbers.                                                                                                                                                       |
| **Bool**           | Yes or no.                                                                                                                                                     |
| **String**         | Text.                                                                                                                                                          |
| **Color**          | A colour.                                                                                                                                                      |
| **Enum**           | One value of an enum (below). The entity is drawn in that value's colour, and its label shows it.                                                              |
| **Point**          | A cell in the level, set with **Pick** and a click on the canvas. Shown as a dashed link from the selected entity.                                             |
| **EntityRef**      | Another entity, in this level or another, optionally of one type only ("Points at"). Chosen from a list grouped by level, or with **Pick**. Shown as an arrow. |

Tick **List** to make any field a list of values; entries are added, edited and removed one by one.

If a referenced entity is deleted, the reference shows as "missing" and exports as `null`. Duplicating a level points references between its own entities at the copies.

## Enums (Project settings → Enums)

An enum is a named list of values, each with a colour: for example `ghost` with blinky, pinky, inky and clyde. Enum fields pick one of them.

## Level fields and background (Project settings → Levels)

**Default level background** colours every level without its own. **Level fields** are fields every level has (for example a time limit or music track); their values are set per level in the Level panel.
