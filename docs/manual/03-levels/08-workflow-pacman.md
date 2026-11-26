# Workflow: build a Pac-Man maze

The Pac-Man preset has everything set up: a 28 × 36 level on an 8 px grid (the arcade's), and three layers.

| Layer          | Type     | Values or entities                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------------------- |
| `collision`    | IntGrid  | 1 `wall`, 2 `intersection_a`, 3 `intersection_b`, 4 `ghost_house_door`, 5 `tunnel_entry`    |
| `collectibles` | IntGrid  | 1 `pellet`, 2 `power_pellet`                                                                |
| `entities`     | Entities | `PacMan`, `Ghost` (with a `kind` enum and a `scatterTarget` point), `Fruit` (with `points`) |

## 1. Start

**Open** (Ctrl+O) → **New** → **Pac-Man (arcade)**. The project opens straight into its one level, with the entities placed and the maze still empty. Name it in the toolbar.

## 2. Walls

1. Click `collision` in Layers and choose `wall` in the palette (or press **1**).
2. Draw the outer wall with the **Rectangle fill** (R) along the edges, then the inner blocks. Use the **Pen** (B) for details.
3. Erase mistakes with the **right mouse button**. Mark the ghost house door with **4** and the tunnel ends with **5**.
4. Values 2 and 3 (`intersection_a`, `intersection_b`) mark corridor cells a game can treat specially, such as junctions; paint them where your game's rules need them.

Turn on **Grid** (#) and watch the rulers: they count cells, with a label every few cells.

## 3. Pellets

1. Switch to `collectibles`.
2. Choose `pellet` (1). Click along the corridors, or use the **Bucket** (G) on an empty corridor area and then erase where pellets don't belong.
3. Put four `power_pellet`s (2) near the corners.

Hide `collectibles` with its eye when you want to see the walls alone.

## 4. Entities

The preset already places Pac-Man, the four ghosts and a fruit; move them to fit your maze.

1. Switch to `entities`.
2. **Drag** Pac-Man to its start cell, below the ghost house. **Shift** moves in pixels; the arrow keys nudge.
3. Select each ghost to see its **kind** in the Inspector (blinky, pinky, inky, clyde); the label and colour follow the value. A level holds at most one Pac-Man, four ghosts and one fruit: placing another moves the most recent one instead.
4. For each ghost, click **Pick** next to **scatterTarget** and click the corner cell it retreats to; a dashed line shows the link.
5. Select the fruit and set its **points**.

To place one from scratch, choose its type in the list (or press **1–3**) and click in the level.

## 5. Save and export

1. **Ctrl+Shift+S** saves `pacman.gs2dlevel`.
2. **Export (JSON)** gives the game file: `collision` and `collectibles` as arrays of 28 × 36 numbers (row by row), and `entities` with each entity's position, cell and fields. See [Level exports](../05-file-formats/02-level-exports.md).
3. **Export (PNG)** gives a picture of the maze for a quick check, or as a background.
