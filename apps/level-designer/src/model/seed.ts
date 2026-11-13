import { LevelProject } from "./LevelProject";

/**
 * Starter project for the Pac-Man maps: the arcade 28×36 tile grid and the
 * collision / collectibles / spawns layers from the original level editor.
 */
export function createPacmanProject(): LevelProject {
  const project = new LevelProject("pacman", 8);

  project.addIntGridLayer("collision", [
    { value: 1, identifier: "wall", color: "#1919a3" },
    { value: 2, identifier: "intersection_a", color: "#47a400" },
    { value: 3, identifier: "intersection_b", color: "#a69801" },
    { value: 4, identifier: "ghost_house_door", color: "#fcb9f8" },
    { value: 5, identifier: "tunnel_entry", color: "#ffffff" },
  ]);
  project.addIntGridLayer("collectibles", [
    { value: 1, identifier: "pellet", color: "#ffb8ae" },
    { value: 2, identifier: "power_pellet", color: "#ff8a65" },
  ]);
  project.addIntGridLayer("spawns", [
    { value: 1, identifier: "pacman", color: "#ffff00" },
    { value: 2, identifier: "blinky", color: "#ff0000" },
    { value: 3, identifier: "inky", color: "#00eeff" },
    { value: 4, identifier: "pinky", color: "#ff00ea" },
    { value: 5, identifier: "clyde", color: "#ff7300" },
  ]);

  const level = project.createLevel("level_0", 28, 36);
  level.doc.setActiveLayer(level.doc.layers[0].id);
  return project;
}
