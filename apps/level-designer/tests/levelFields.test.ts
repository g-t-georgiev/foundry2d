import { describe, it, expect } from "vite-plus/test";
import { HistoryManager } from "@foundry2d/core";
import { createProjectFromPreset } from "../src/model/presets";
import { DefinitionEditCommand, SetLevelPropertiesCommand } from "../src/model/commands";
import { deserializeProject, serializeProject } from "../src/io/projectFile";
import { toGameFormat } from "../src/io/gameFormat";

function setup() {
  const project = createProjectFromPreset("blank");
  const history = new HistoryManager();
  project.definitionRecorder = (label, before, after) =>
    history.record(new DefinitionEditCommand(project, label, before, after));
  const level = project.levels[0];
  const music = project.addLevelField("String", "music")!;
  const mood = project.addEnum("mood");
  project.addEnumValue(mood.uid, "calm");
  project.addEnumValue(mood.uid, "tense");
  const moodField = project.addLevelField("Enum", "mood")!;
  return { project, history, level, music, mood, moodField };
}

describe("level fields and background", () => {
  it("sets values and background as one undo step", () => {
    const { project, history, level, music } = setup();
    history.execute(
      new SetLevelPropertiesCommand(project, level, {
        bgColor: "#203040",
        fields: { [music.uid]: "cave.ogg" },
      })
    );
    expect(level.bgColor).toBe("#203040");
    expect(project.levelBackground(level)).toBe("#203040");
    history.undo();
    expect(level.bgColor).toBeNull();
    expect(project.levelBackground(level)).toBe(project.defaultLevelBg);
    expect(level.fields[music.uid]).toBeUndefined();
  });

  it("removing a field drops its values; undo brings them back", () => {
    const { project, history, level, music } = setup();
    level.fields[music.uid] = "cave.ogg";
    project.removeLevelField(music.uid);
    expect(level.fields[music.uid]).toBeUndefined();
    history.undo();
    expect(project.defs.levelFields.map((f) => f.identifier)).toContain("music");
    expect(level.fields[music.uid]).toBe("cave.ogg");
  });

  it("carries enum renames into level values", () => {
    const { project, level, mood, moodField } = setup();
    level.fields[moodField.uid] = "tense";
    project.updateEnumValue(mood.uid, "tense", { id: "scary" });
    expect(level.fields[moodField.uid]).toBe("scary");
  });

  it("round-trips through the project file and the game export", () => {
    const { project, level, music } = setup();
    level.bgColor = "#102030";
    level.fields[music.uid] = "cave.ogg";
    project.setDefaultLevelBg("#000000");
    const loaded = deserializeProject(JSON.parse(JSON.stringify(serializeProject(project))));
    expect(loaded.defs.levelFields).toEqual(project.defs.levelFields);
    expect(loaded.defaultLevelBg).toBe("#000000");
    expect(loaded.levels[0].bgColor).toBe("#102030");
    expect(loaded.levels[0].fields).toEqual(level.fields);

    const game = toGameFormat(project, level);
    expect(game.metadata.bgColor).toBe("#102030");
    expect(game.fields).toEqual({ music: "cave.ogg", mood: "calm" });
  });

  it("duplicated levels copy the background and field values", () => {
    const { project, level, music } = setup();
    level.bgColor = "#102030";
    level.fields[music.uid] = "cave.ogg";
    const copy = project.cloneLevel(level.uid, 999, 0)!;
    expect(copy.bgColor).toBe("#102030");
    expect(copy.fields).toEqual(level.fields);
    copy.fields[music.uid] = "other.ogg";
    expect(level.fields[music.uid]).toBe("cave.ogg");
  });
});
