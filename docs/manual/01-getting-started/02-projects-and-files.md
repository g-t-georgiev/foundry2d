# Projects, saving and files

All three apps save the same way. What you are working on is called a **project** here (a sprite, a level project or a pack).

## The start screen

Press **Ctrl+O** or click **Open** (**Projects…** in Pixel) to see it. It opens by itself at startup when you have saved work. It has:

- **New:** templates. Pixel offers empty sprites of 16, 32, 64 and 128 pixels; Levels its presets (Blank, Pac-Man, Platformer); Packer packs set up for an engine (Empty for Phaser and PixiJS, Godot 4, LibGDX, Web).
- **Open file…:** a work file from your disk.
- **Recent files:** files you opened or saved lately (Chrome and Edge).
- **In this browser:** your library, with thumbnails, how much storage it uses, and buttons to duplicate (⧉) or delete (✕) an entry. Deleting asks first and never touches files on disk.

When the open project has unsaved changes, anything that would replace it asks first.

## Saving

- **Save (Ctrl+S)** stores the project in the browser library and, if it came from a file or was saved to one, writes that file too.
- **Save as file… (Ctrl+Shift+S)** asks where to save (Chrome and Edge); later saves go to that file. Other browsers download a copy instead.
- **Save a copy in this browser…** (the arrow next to Save as) asks for a name and continues with the copy; the original stays as it was.

The title bar and the status bar show a **•** while there are unsaved changes, and closing the tab then asks first.

### The library and your files

Saving to a file also keeps a copy in the library, so the project is one click away on the start screen. That copy remembers its file: open the file again and save, and the same copy is updated. It stays a separate project only when it holds newer work than the file, or when you opened and saved the library copy itself.

## Crash recovery

A moment after each change, the app keeps a snapshot of your unsaved work. If the tab closes or the browser crashes, the next start restores it ("Restored unsaved work from the last session"), still connected to its library entry or file.

## Opening files

- Use **Open file…** on the start screen, or pick one under **Recent files**.
- Installed apps open their files from the desktop (see [The three apps](01-the-apps.md)). If you have unsaved work, you are asked before it is replaced.
- Files from before Game Studio 2D (named Foundry2D then: `.f2dsprite`, `.f2dlevel`, `.f2dpack`, and the even older `.f2d.json` and `.f2dlevel.json`) still open; saving writes the new names.

## Where your data lives

The library, images, recent files and recovery snapshots are in the browser's storage for this site (IndexedDB). Clearing the site's data removes them, so save important work to files. In private windows some browsers allow no storage; the start screen then warns that projects saved in the browser are lost on reload.
