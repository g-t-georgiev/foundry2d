# Workflow: pack a game's sprites

A game with a player animation, enemies and items, packed for Phaser.

## 1. Prepare the folder

Keep the art in one folder with subfolders, and number animation frames:

```
art/
  player/idle_1.png  idle_2.png
  player/walk_1.png  walk_2.png  walk_3.png  walk_4.png
  enemies/bat_1.png  bat_2.png
  items/coin.png  heart.png
```

## 2. Create the pack

1. **Open** → **New** → **Empty pack** (TexturePacker JSON for Phaser).
2. Name it `game` in the toolbar.
3. Click **Live folder** and pick `art` (in Chrome or Edge), or **+ Folder** in other browsers.

The sprites appear as `art/player/idle_1` and so on, packed on one sheet. The **Animation** panel offers `art/player/idle`, `art/player/walk` and `art/enemies/bat`.

## 3. Set pivots

1. Click `art/player/walk_1`, then Shift-click the other player frames.
2. **Pivot** → **Bottom centre**: the player stands on its position.
3. Watch the walk in the **Animation** panel, at the **Frames per second** you set.

## 4. Tune the sheet

- Keep **Trim** and **Store identical sprites once** on.
- Set **Padding** to 2 and **Extrude** to 1 if the game scales the art.
- Check **Result**: one sheet, and how full it is.

## 5. Save and export

1. **Ctrl+Shift+S** saves `game.f2dpack`. The images are stored in it, so it opens anywhere.
2. **Export (ZIP)** gives `game.png` and `game.json`.

## 6. Keep working

Edit `art/player/walk_2.png` in your drawing program and save it: with a live folder, the pack updates within a couple of seconds. Export again.

In Phaser:

```js
this.load.atlas("game", "game.png", "game.json");
// …
this.anims.create({
  key: "walk",
  frames: this.anims.generateFrameNames("game", {
    prefix: "art/player/walk_",
    start: 1,
    end: 4,
    suffix: ".png",
  }),
  frameRate: 10,
  repeat: -1,
});
```
