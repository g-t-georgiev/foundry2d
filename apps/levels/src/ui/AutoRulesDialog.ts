import { el } from "@gs2d/ui";
import type { LevelProject } from "../model/LevelProject";
import {
  ANY_VALUE,
  AUTO_RULE_SIZES,
  ruleOutOfBounds,
  ruleStops,
  type AutoRule,
  type AutoRuleGroup,
  type AutoRuleSize,
  type OutOfBounds,
} from "../model/autoRules";
import { tileSourceRect, tilesetGrid, type TileSelection } from "../model/tiles";
import type { LayerDef, TilesetDef } from "../model/types";
import TilesetPickerView from "./TilesetPickerView";

/** Bounding rectangle (in tiles) of a set of tile ids, for the picker highlight. */
function selectionOf(tileset: TilesetDef, tileIds: number[]): TileSelection | null {
  const { columns } = tilesetGrid(tileset);
  if (tileIds.length === 0 || columns === 0) return null;
  const xs = tileIds.map((id) => id % columns);
  const ys = tileIds.map((id) => Math.floor(id / columns));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x + 1, height: Math.max(...ys) - y + 1 };
}

/**
 * Editor for an auto-layer's rules: a prioritised list on the left (first
 * match wins), and on the right the selected rule's neighbour pattern,
 * tiles, chance and mirroring. Every edit regenerates the layer at once, so
 * the level behind the dialog shows the result live.
 */
export default class AutoRulesDialog {
  private project: LevelProject | null = null;
  private defUid: number | null = null;
  private selectedRuleUid: number | null = null;
  /** Condition painted by a left click in the pattern (right click paints its negation). */
  private brush = 1;
  private readonly list: HTMLElement;
  private readonly editor: HTMLElement;
  private readonly title: HTMLElement;
  private readonly pickerHost: HTMLElement;
  private readonly picker: TilesetPickerView;

  constructor(private readonly dialog: HTMLDialogElement) {
    const $ = <T extends Element>(sel: string) => dialog.querySelector<T>(sel)!;
    this.list = $("#rulesList");
    this.editor = $("#ruleEditor");
    this.title = $("#rulesTitle");
    // The picker lives outside the re-rendered editor so it keeps its canvas.
    this.pickerHost = el("div", { className: "tileset-host rules-picker" });
    this.picker = new TilesetPickerView(this.pickerHost, (tileset, selection) => {
      const { columns } = tilesetGrid(tileset);
      const ids: number[] = [];
      for (let y = selection.y; y < selection.y + selection.height; y++) {
        for (let x = selection.x; x < selection.x + selection.width; x++) ids.push(y * columns + x);
      }
      this.updateRule({ tileIds: ids });
    });

    $("#addRule").addEventListener("click", () => {
      if (!this.project || this.defUid === null) return;
      // A new rule joins the selected rule's group.
      const group = this.selectedRule()?.groupUid ?? null;
      const rule = this.project.addAutoRule(this.defUid, this.brushValue());
      if (rule && group !== null)
        this.project.updateAutoRule(this.defUid, rule.uid, { groupUid: group });
      this.selectedRuleUid = rule?.uid ?? null;
      this.render();
    });
    $("#addRuleGroup").addEventListener("click", () => {
      if (!this.project || this.defUid === null) return;
      this.project.addAutoGroup(this.defUid);
      this.render();
    });
    // Group headers: switch, rename, move, delete.
    this.list.addEventListener("change", (ev) => {
      const target = ev.target as HTMLInputElement;
      const header = target.closest<HTMLElement>("[data-group]");
      if (!header || !this.project || this.defUid === null) return;
      const uid = Number(header.dataset.group);
      if (target.dataset.action === "group-toggle") {
        this.project.updateAutoGroup(this.defUid, uid, { active: target.checked });
      } else if (target.dataset.action === "group-name") {
        this.project.updateAutoGroup(this.defUid, uid, { name: target.value });
      }
      this.render();
    });
    $("#reshuffleRules").addEventListener("click", () => {
      if (this.project && this.defUid !== null) this.project.reshuffleAutoLayer(this.defUid);
    });
    this.list.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      const header = target.closest<HTMLElement>("[data-group]");
      const groupAction = target.closest<HTMLElement>("[data-action]")?.dataset.action;
      if (header && this.project && this.defUid !== null) {
        const uid = Number(header.dataset.group);
        if (groupAction === "group-up" || groupAction === "group-down") {
          this.project.moveAutoGroup(this.defUid, uid, groupAction === "group-up" ? "up" : "down");
        } else if (groupAction === "group-delete") {
          this.project.removeAutoGroup(this.defUid, uid);
        } else return;
        this.render();
        return;
      }
      const item = target.closest<HTMLElement>("[data-uid]");
      if (!item || !this.project || this.defUid === null) return;
      const uid = Number(item.dataset.uid);
      const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
      const project = this.project;
      const defUid = this.defUid;
      switch (action) {
        case "toggle":
          project.updateAutoRule(defUid, uid, {
            active: !project.getAutoRule(defUid, uid)?.active,
          });
          break;
        case "up":
        case "down":
          project.moveAutoRule(defUid, uid, action);
          break;
        case "duplicate":
          this.selectedRuleUid = project.duplicateAutoRule(defUid, uid)?.uid ?? uid;
          this.render();
          return;
        case "delete":
          project.removeAutoRule(defUid, uid);
          break;
      }
      if (!action) this.selectedRuleUid = uid;
      this.render();
    });
  }

  open(project: LevelProject, defUid: number): void {
    this.project = project;
    this.defUid = defUid;
    const def = project.getLayerDef(defUid);
    this.selectedRuleUid = def?.autoRules?.[0]?.uid ?? null;
    this.brush = project.autoSourceOf(def)?.intGridValues[0]?.value ?? ANY_VALUE;
    if (!this.dialog.open) this.dialog.showModal();
    this.render();
  }

  /** Re-renders if open (e.g. after a tileset image finished loading). */
  refresh(): void {
    if (this.dialog.open) this.render();
  }

  private get def(): LayerDef | undefined {
    return this.defUid === null ? undefined : this.project?.getLayerDef(this.defUid);
  }

  private selectedRule(): AutoRule | undefined {
    return this.def?.autoRules?.find((r) => r.uid === this.selectedRuleUid);
  }

  private brushValue(): number | null {
    return this.brush === ANY_VALUE || this.brush === -ANY_VALUE ? null : this.brush;
  }

  private updateRule(patch: Partial<Omit<AutoRule, "uid">>): void {
    if (!this.project || this.defUid === null || this.selectedRuleUid === null) return;
    this.project.updateAutoRule(this.defUid, this.selectedRuleUid, patch);
    this.render();
  }

  private render(): void {
    const project = this.project;
    const def = this.def;
    const source = project?.autoSourceOf(def);
    if (!project || !def || !source) {
      this.dialog.close();
      return;
    }
    const tileset = project.getTileset(def.tilesetUid);
    const rules = project.orderedAutoRules(def);
    const groups = def.autoGroups ?? [];
    if (!rules.some((r) => r.uid === this.selectedRuleUid)) {
      this.selectedRuleUid = rules[0]?.uid ?? null;
    }
    this.title.textContent = `Rules · ${def.identifier} (from ${source.identifier})`;

    const colorOf = (value: number) =>
      source.intGridValues.find((v) => v.value === Math.abs(value))?.color ?? "#888888";

    const groupOf = (rule: AutoRule) => groups.find((g) => g.uid === rule.groupUid);
    let section: AutoRuleGroup | undefined | null = null;
    const items: HTMLElement[] = [];
    const header = (group: AutoRuleGroup | undefined) => {
      if (!group) {
        items.push(el("li", { className: "rule-group-header", textContent: "Ungrouped" }));
        return;
      }
      items.push(this.groupHeader(group, groups.indexOf(group), groups.length));
    };
    rules.forEach((rule, index) => {
      const group = groupOf(rule);
      if (groups.length && group !== section) {
        header(group);
        section = group;
      }
      items.push(this.ruleItem(project, tileset, rule, index, colorOf, group));
    });
    // Empty groups still get their header, so rules can be added to them.
    for (const group of groups) {
      if (!rules.some((r) => r.groupUid === group.uid)) {
        header(group);
        items.push(
          el("li", {
            className: "empty",
            textContent: "No rules yet: select a rule and pick this group, or add one here.",
          })
        );
      }
    }
    this.list.replaceChildren(...items);
    if (rules.length === 0) {
      this.list.append(
        el("li", {
          className: "empty",
          textContent: "No rules yet. Add one: it tiles every cell holding the chosen value.",
        })
      );
    }

    const rule = rules.find((r) => r.uid === this.selectedRuleUid);
    const stored = def.autoRules?.find((r) => r.uid === rule?.uid);
    this.editor.replaceChildren(
      ...(stored ? this.ruleEditor(project, source, tileset, stored, colorOf) : [])
    );
  }

  private groupHeader(group: AutoRuleGroup, index: number, count: number): HTMLElement {
    const header = el("li", { className: "rule-group-header" });
    header.dataset.group = String(group.uid);
    header.classList.toggle("inactive", !group.active);
    const toggle = el("input", {
      type: "checkbox",
      checked: group.active,
      title: "Group active (switches all its rules)",
    });
    toggle.dataset.action = "group-toggle";
    const name = el("input", { className: "input input-small", value: group.name });
    name.dataset.action = "group-name";
    name.setAttribute("aria-label", "Group name");
    const button = (action: string, text: string, title: string, disabled = false) => {
      const b = el("button", {
        className: "btn btn-icon",
        type: "button",
        textContent: text,
        title,
      });
      b.dataset.action = action;
      b.disabled = disabled;
      b.setAttribute("aria-label", title);
      return b;
    };
    header.append(
      toggle,
      name,
      el(
        "span",
        { className: "rule-actions" },
        button("group-up", "↑", "Move group up (higher priority)", index === 0),
        button("group-down", "↓", "Move group down", index === count - 1),
        button("group-delete", "✕", "Delete group (its rules stay, ungrouped)")
      )
    );
    return header;
  }

  private ruleItem(
    project: LevelProject,
    tileset: TilesetDef | undefined,
    rule: AutoRule,
    index: number,
    colorOf: (v: number) => string,
    group: AutoRuleGroup | undefined
  ): HTMLElement {
    const item = el("li", { className: "rule-item" });
    item.dataset.uid = String(rule.uid);
    item.setAttribute("aria-selected", String(rule.uid === this.selectedRuleUid));
    item.classList.toggle("inactive", !rule.active);
    item.classList.toggle("grouped", group !== undefined);
    // The list shows group switches applied; the checkbox is the rule's own.
    const own = project.getAutoRule(this.defUid!, rule.uid)?.active ?? rule.active;
    const toggle = el("input", { type: "checkbox", checked: own, title: "Active" });
    toggle.dataset.action = "toggle";
    const button = (action: string, text: string, title: string) => {
      const b = el("button", {
        className: "btn btn-icon",
        type: "button",
        textContent: text,
        title,
      });
      b.dataset.action = action;
      b.setAttribute("aria-label", title);
      return b;
    };
    item.append(
      toggle,
      el("span", { className: "rule-index", textContent: String(index + 1) }),
      this.patternPreview(rule, colorOf),
      this.tilePreview(project, tileset, rule),
      el("span", {
        className: "rule-meta",
        textContent: `${rule.size}×${rule.size}${rule.chance < 1 ? ` · ${Math.round(rule.chance * 100)}%` : ""}${rule.flipX ? " · ↔" : ""}${rule.flipY ? " · ↕" : ""}${ruleStops(rule) ? "" : " · ⇣ stacks"}${rule.offsetX || rule.offsetY ? ` · +${rule.offsetX ?? 0},${rule.offsetY ?? 0}px` : ""}`,
      }),
      el(
        "span",
        { className: "rule-actions" },
        button("up", "↑", "Move up (higher priority)"),
        button("down", "↓", "Move down"),
        button("duplicate", "⧉", "Duplicate"),
        button("delete", "✕", "Delete")
      )
    );
    return item;
  }

  private patternPreview(rule: AutoRule, colorOf: (v: number) => string): HTMLElement {
    const preview = el("span", { className: "pattern-mini" });
    preview.style.setProperty("--size", String(rule.size));
    for (const condition of rule.pattern) {
      const cell = el("span");
      this.paintCondition(cell, condition, colorOf);
      preview.append(cell);
    }
    return preview;
  }

  private tilePreview(
    project: LevelProject,
    tileset: TilesetDef | undefined,
    rule: AutoRule
  ): HTMLElement {
    const canvas = el("canvas", { className: "tile-mini", width: 16, height: 16 });
    const image = tileset ? project.getTilesetImage(tileset) : undefined;
    const src = tileset && rule.tileIds.length ? tileSourceRect(tileset, rule.tileIds[0]) : null;
    const ctx = canvas.getContext("2d");
    if (ctx && image && src) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, src.x, src.y, src.width, src.height, 0, 0, 16, 16);
    }
    canvas.title = rule.tileIds.length
      ? `${rule.tileIds.length} tile${rule.tileIds.length > 1 ? "s (random)" : ""}`
      : "No tiles yet";
    return canvas;
  }

  /** Styles a pattern cell for a condition. */
  private paintCondition(cell: HTMLElement, condition: number, colorOf: (v: number) => string) {
    cell.className = "cond";
    cell.textContent = "";
    if (condition === 0) {
      cell.classList.add("cond-any");
    } else if (condition === ANY_VALUE) {
      cell.classList.add("cond-filled");
      cell.textContent = "*";
    } else if (condition === -ANY_VALUE) {
      cell.classList.add("cond-empty");
      cell.textContent = "∅";
    } else {
      cell.style.setProperty("--cond", colorOf(condition));
      cell.classList.add(condition > 0 ? "cond-is" : "cond-not");
      if (condition < 0) cell.textContent = "✕";
    }
  }

  private ruleEditor(
    project: LevelProject,
    source: LayerDef,
    tileset: TilesetDef | undefined,
    rule: AutoRule,
    colorOf: (v: number) => string
  ): HTMLElement[] {
    // Brush: which condition a click paints.
    const brushes: { value: number; label: string; color?: string }[] = [
      ...source.intGridValues.map((v) => ({ value: v.value, label: v.identifier, color: v.color })),
      { value: ANY_VALUE, label: "any value" },
    ];
    const brushRow = el("div", { className: "brush-row", role: "radiogroup" });
    brushRow.setAttribute("aria-label", "Condition to paint");
    for (const b of brushes) {
      const chip = el("button", { className: "brush-chip", type: "button", textContent: b.label });
      if (b.color) chip.style.setProperty("--chip", b.color);
      chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", String(this.brush === b.value));
      chip.addEventListener("click", () => {
        this.brush = b.value;
        this.render();
      });
      brushRow.append(chip);
    }

    // Pattern grid: left click = must be, right click = must not be, again = anything.
    const grid = el("div", { className: "pattern-grid" });
    grid.style.setProperty("--size", String(rule.size));
    const center = (rule.size * rule.size - 1) / 2;
    rule.pattern.forEach((condition, i) => {
      const cell = el("button", { type: "button" });
      this.paintCondition(cell, condition, colorOf);
      if (i === center) cell.classList.add("cond-center");
      cell.title =
        condition === 0
          ? "Anything"
          : condition === ANY_VALUE
            ? "Any value"
            : condition === -ANY_VALUE
              ? "Empty"
              : `${condition > 0 ? "Must be" : "Must not be"} ${source.intGridValues.find((v) => v.value === Math.abs(condition))?.identifier ?? Math.abs(condition)}`;
      const set = (next: number) => {
        const pattern = [...rule.pattern];
        pattern[i] = pattern[i] === next ? 0 : next;
        this.updateRule({ pattern });
      };
      cell.addEventListener("click", () => set(this.brush));
      cell.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        set(-this.brush);
      });
      grid.append(cell);
    });

    const size = el("select", { className: "input input-small" });
    size.setAttribute("aria-label", "Pattern size");
    for (const s of AUTO_RULE_SIZES)
      size.append(new Option(`${s}×${s}`, String(s), false, s === rule.size));
    size.addEventListener("change", () =>
      this.updateRule({ size: Number(size.value) as AutoRuleSize })
    );

    const chance = el("input", {
      type: "range",
      min: "0",
      max: "100",
      step: "1",
      value: String(Math.round(rule.chance * 100)),
    });
    const chanceLabel = el("span", {
      className: "value",
      textContent: `${Math.round(rule.chance * 100)}%`,
    });
    chance.addEventListener("input", () => (chanceLabel.textContent = `${chance.value}%`));
    chance.addEventListener("change", () =>
      this.updateRule({ chance: Number(chance.value) / 100 })
    );

    const check = (
      label: string,
      checked: boolean,
      onChange: (v: boolean) => void,
      title: string
    ) => {
      const input = el("input", { type: "checkbox", checked });
      input.addEventListener("change", () => onChange(input.checked));
      return el(
        "label",
        { className: "checkbox-field", title },
        input,
        el("span", { textContent: label })
      );
    };

    this.picker.render(project, tileset, tileset ? selectionOf(tileset, rule.tileIds) : null);

    // Past the level edge.
    const edge = el("select", { className: "input" });
    edge.setAttribute("aria-label", "Cells past the level edge");
    const current = ruleOutOfBounds(rule);
    edge.append(
      new Option("repeat the edge", "edge", false, current === "edge"),
      new Option("rule fails", "fail", false, current === "fail"),
      new Option("empty", "0", false, current === 0),
      ...source.intGridValues.map(
        (v) => new Option(v.identifier, String(v.value), false, current === v.value)
      )
    );
    edge.addEventListener("change", () => {
      const v = edge.value;
      const next: OutOfBounds = v === "edge" || v === "fail" ? v : Number(v);
      this.updateRule({ outOfBounds: next });
    });

    const offset = (axis: "offsetX" | "offsetY") => {
      const input = el("input", {
        className: "input input-small",
        type: "number",
        step: "1",
        value: String(rule[axis] ?? 0),
      });
      input.setAttribute(
        "aria-label",
        axis === "offsetX" ? "Tile offset X (px)" : "Tile offset Y (px)"
      );
      input.addEventListener("change", () => {
        const n = Math.round(Number(input.value));
        this.updateRule({ [axis]: Number.isFinite(n) ? n : 0 });
      });
      return input;
    };

    const groups = this.def?.autoGroups ?? [];
    const groupSelect = el("select", { className: "input" });
    groupSelect.setAttribute("aria-label", "Rule group");
    groupSelect.append(new Option("— no group —", ""));
    for (const g of groups) {
      groupSelect.append(new Option(g.name, String(g.uid), false, g.uid === rule.groupUid));
    }
    groupSelect.disabled = groups.length === 0;
    groupSelect.addEventListener("change", () =>
      this.updateRule({ groupUid: groupSelect.value ? Number(groupSelect.value) : null })
    );

    return [
      el(
        "div",
        { className: "rule-columns" },
        el(
          "div",
          { className: "rule-pattern" },
          el(
            "div",
            { className: "column-header" },
            el("span", { className: "label", textContent: "Pattern" }),
            size
          ),
          brushRow,
          grid,
          el("p", {
            className: "hint",
            textContent:
              "Click: must be the chosen value. Right-click: must not be. Click again: anything. The outlined cell gets the tile.",
          })
        ),
        el(
          "div",
          { className: "rule-tiles" },
          el("span", {
            className: "label",
            textContent: tileset
              ? "Tiles (drag to pick several: one is chosen at random)"
              : "Tiles",
          }),
          tileset
            ? this.pickerHost
            : el("p", {
                className: "hint",
                textContent: "This layer has no tileset. Pick one in Project settings.",
              }),
          el(
            "label",
            { className: "field" },
            el("span", { className: "label", textContent: "Chance" }),
            el("span", { className: "field-pair" }, chance, chanceLabel)
          ),
          el(
            "div",
            { className: "button-row" },
            check(
              "Mirror X",
              rule.flipX,
              (v) => this.updateRule({ flipX: v }),
              "Also match the pattern mirrored left↔right (the tile is flipped)"
            ),
            check(
              "Mirror Y",
              rule.flipY,
              (v) => this.updateRule({ flipY: v }),
              "Also match the pattern mirrored top↔bottom (the tile is flipped)"
            ),
            check(
              "Stop here",
              ruleStops(rule),
              (v) => this.updateRule({ breakOnMatch: v }),
              "When this rule matches, later rules skip the cell. Off: they can add tiles on top of each other in the same cell."
            )
          ),
          el(
            "label",
            { className: "field" },
            el("span", { className: "label", textContent: "Past the level edge, cells read as" }),
            edge
          ),
          el(
            "label",
            { className: "field" },
            el("span", { className: "label", textContent: "Tile offset (px)" }),
            el("span", { className: "field-pair" }, offset("offsetX"), offset("offsetY"))
          ),
          el(
            "label",
            { className: "field" },
            el("span", { className: "label", textContent: "Group" }),
            groupSelect
          )
        )
      ),
    ];
  }
}
