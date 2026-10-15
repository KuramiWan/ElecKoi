import { describe, expect, it, vi } from "vitest";
import { settingLibrarySchema } from "../../../../packages/shared/src/contracts/settingLibrary/schemas";
import {
  createLibraryVersion,
  deleteActiveLibraryVersion,
  importLibraryAsVersion,
  mergeSettingLibraryEntries,
  parseSettingLibraryFile,
  serializeSettingLibrary,
  switchLibraryVersion,
} from "../../src/modules/settingLibraries/model/settingLibraryTransfer.js";

function entry(id, title, groupId = "", order = 1) {
  return {
    id, title, iconId: "", kind: "normal", groupId, content: `${title}正文`, openingMessages: [],
    defaultOpeningMessageId: "", agentSelectionHint: "", agentReadStrategy: "normal",
    dynamicMode: "standard", contentMode: "plain_text", keywords: [], keywordScanDepth: 1,
    conditionKeywords: [], keywordCondition: "none", keywordUseRegex: false, keywordIgnoreCase: true,
    keywordWholeWord: false, keywordRecursionDepth: 0, triggerMode: "always", enabled: true,
    position: "insert_point_1", promptPositionId: "", insertRole: "user", order,
    viewOrder: order, groupViewOrder: order, treeViewOrder: order, createdAt: "", updatedAt: "",
  };
}

function fixed(id, kind, title) {
  return { ...entry(id, title), kind, openingMessages: kind === "opening" ? [{ id: "opening", title: "默认开场", content: "", initialVariableStateJson: "" }] : [], defaultOpeningMessageId: kind === "opening" ? "opening" : "" };
}

function version(id, name, entries, groups = []) {
  return { id, name, entries, groups, promptPositions: [], listAllExpanded: true, expandedGroupIds: [], createdAt: "", updatedAt: "" };
}

function library() {
  const fixedEntries = [
    fixed("fixed-opening-assistant", "opening", "AI角色开场白"),
  ];
  const first = version("v1", "第一版", [...fixedEntries, entry("a", "旧设定")]);
  const second = version("v2", "第二版", [...fixedEntries, entry("b", "第二版设定")]);
  return {
    characterId: "character-1", name: first.name, entries: first.entries, groups: [], promptPositions: [],
    activeVersionId: first.id, versions: [first, second], listAllExpanded: true, expandedGroupIds: [],
  };
}

describe("setting-library versions and transfer", () => {
  it("keeps unsaved active edits when switching versions", () => {
    const source = library();
    source.entries = source.entries.map((item) => item.id === "a" ? { ...item, content: "未保存修改" } : item);
    const switched = switchLibraryVersion(source, "v2");
    expect(switched.activeVersionId).toBe("v2");
    expect(switched.entries.find((item) => item.id === "b")).toBeTruthy();
    expect(switched.versions.find((item) => item.id === "v1").entries.find((item) => item.id === "a").content).toBe("未保存修改");
  });

  it("creates a copy or a blank version without saving it", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("copy").mockReturnValueOnce("blank") });
    const copied = createLibraryVersion(library(), "副本", "v1");
    expect(copied).toMatchObject({ activeVersionId: "library-copy", name: "副本" });
    expect(copied.entries.some((item) => item.id === "a")).toBe(true);
    const blank = createLibraryVersion(copied, "空白", "");
    expect(blank).toMatchObject({ activeVersionId: "library-blank", name: "空白" });
    expect(blank.entries.map((item) => item.id)).toEqual(["fixed-opening-assistant"]);
    vi.unstubAllGlobals();
  });

  it("replaces the final deleted version with one blank version", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "replacement" });
    const source = library();
    source.versions = [source.versions[0]];
    const deleted = deleteActiveLibraryVersion(source);
    expect(deleted.versions).toHaveLength(1);
    expect(deleted).toMatchObject({ activeVersionId: "library-replacement", name: "新版本" });
    expect(deleted.entries.map((item) => item.id)).toEqual(["fixed-opening-assistant"]);
    vi.unstubAllGlobals();
  });

  it("round-trips the Android-aligned ElecKoi v3 export as a new version", () => {
    const source = library();
    const parsed = parseSettingLibraryFile(serializeSettingLibrary(source), "eleckoi");
    expect(parsed).toMatchObject({ name: "第一版" });
    expect(parsed.entries.find((item) => item.id === "a")).toMatchObject({ title: "旧设定", content: "旧设定正文" });
    const imported = importLibraryAsVersion(source, parsed);
    expect(imported.versions).toHaveLength(3);
    expect(imported.activeVersionId).not.toBe("v1");
  });

  it("rebuilds selected folder ancestors and resolves title and order collisions when merging", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("parent").mockReturnValueOnce("nested").mockReturnValueOnce("entry") });
    const target = library();
    target.entries.push(entry("taken", "重复", "", 1));
    const imported = version("source", "来源", [entry("source-entry", "重复", "nested", 1)], [
      { id: "parent", name: "父级", parentId: "", order: 1, treeViewOrder: 1, createdAt: "", updatedAt: "" },
      { id: "nested", name: "子级", parentId: "parent", order: 1, treeViewOrder: 1, createdAt: "", updatedAt: "" },
    ]);
    const merged = mergeSettingLibraryEntries(target, imported, new Set(["source-entry"]));
    expect(merged.plan).toMatchObject({ entryCount: 1, newFolderCount: 2, renamedEntryCount: 0, reorderedEntryCount: 1 });
    const importedEntry = merged.library.entries.find((item) => item.id === "setting-entry");
    expect(importedEntry).toMatchObject({ title: "重复", groupId: "group-nested", order: 2 });
    vi.unstubAllGlobals();
  });

  it("preserves native entry, folder, position and opening variable identities through export and version import", () => {
    const source = library();
    source.entries = source.entries.map(item => ({ ...item, contentMode: "plain_text" }));
    source.groups = [{ id: "synthetic-folder", name: "合成文件夹", parentId: "", order: 1, treeViewOrder: 1, createdAt: "", updatedAt: "" }];
    source.promptPositions = [{ id: "synthetic-position", name: "合成位置", anchor: "instructions", side: "after_setting_position", order: 1, createdAt: "", updatedAt: "" }];
    source.entries[1] = { ...source.entries[1], groupId: "synthetic-folder", promptPositionId: "synthetic-position" };
    source.entries[0].openingMessages = [
      { id: "synthetic-opening-a", title: "开场一", content: "合成开场一", variableVersionId: "synthetic-variables-a", initialVariableStateJson: "" },
      { id: "synthetic-opening-b", title: "开场二", content: "合成开场二", variableVersionId: "synthetic-variables-b", initialVariableStateJson: "{\"score\":2}" },
    ];
    source.entries[0].defaultOpeningMessageId = "synthetic-opening-b";
    const exported = serializeSettingLibrary(source);
    expect(JSON.parse(exported).entries[0].opening_messages.map(item => item.variable_version_id))
      .toEqual(["synthetic-variables-a", "synthetic-variables-b"]);
    const imported = importLibraryAsVersion(source, parseSettingLibraryFile(exported, "eleckoi"));
    expect(imported.activeVersionId).not.toBe(source.activeVersionId);
    expect(imported.entries).toEqual(source.entries);
    expect(imported.groups).toEqual(source.groups);
    expect(imported.promptPositions).toEqual(source.promptPositions);
    const switched = switchLibraryVersion(imported, "v1");
    expect(switched.entries[1]).toMatchObject({ id: "a", groupId: "synthetic-folder", promptPositionId: "synthetic-position" });
    expect(switched.entries[0].openingMessages).toEqual(source.entries[0].openingMessages);
  });

  it("imports a SillyTavern world book into one folder", () => {
    const parsed = parseSettingLibraryFile(JSON.stringify({ name: "世界书", entries: { 0: { comment: "地点", content: "内容", keys: ["城堡"] } } }), "sillytavern");
    expect(parsed.name).toBe("世界书");
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({ title: "地点", keywords: ["城堡"], agentReadStrategy: "keyword" });
  });

  it.each(['entries', 'character_book', 'data.character_book'])('produces saveable entries for %s in both version imports and merges', (shape) => {
    const entries = [
      { comment: 'Synthetic keyword', content: 'Synthetic text', key: ['synthetic-key'], disable: true },
      { comment: 'Synthetic constant', content: 'Synthetic constant text', constant: true },
      { comment: 'Synthetic controller', content: '<%- await getwi(null, "Synthetic reference") %>', constant: true },
      { comment: 'Synthetic reference', content: 'Synthetic reference text' },
    ];
    const source = shape === 'entries' ? { entries: Object.fromEntries(entries.map((item, index) => [index, item])) }
      : shape === 'character_book' ? { character_book: { entries } } : { data: { character_book: { entries } } };
    const parsed = parseSettingLibraryFile(JSON.stringify(source), 'sillytavern');
    expect(Object.fromEntries(parsed.entries.map(item => [item.title, item.contentMode]))).toEqual({
      'Synthetic keyword': 'plain_text', 'Synthetic constant': 'plain_text',
      'Synthetic controller': 'ejs', 'Synthetic reference': 'plain_text',
    });
    const imported = importLibraryAsVersion(library(), parsed);
    expect(() => settingLibrarySchema.parse(imported)).not.toThrow();
    expect(imported.versions.find(item => item.id === 'v1').entries.find(item => item.id === 'a')).toMatchObject({ content: '旧设定正文' });
    const merged = mergeSettingLibraryEntries(library(), parsed, parsed.entries.map(item => item.id)).library;
    expect(() => settingLibrarySchema.parse(merged)).not.toThrow();
    expect(merged.activeVersionId).toBe('v1');
    expect(merged.entries.find(item => item.id === 'a')).toMatchObject({ content: '旧设定正文' });
    expect(merged.entries.find(item => item.title === 'Synthetic keyword')).toMatchObject({ contentMode: 'plain_text', enabled: false });
    const exported = parseSettingLibraryFile(serializeSettingLibrary(imported), 'eleckoi');
    expect(exported.entries.map(item => item.contentMode)).toEqual(imported.entries.map(item => item.contentMode));
  });

  it("classifies EJS controllers and their getwi references like Android", () => {
    const parsed = parseSettingLibraryFile(JSON.stringify({ name: "剧情", entries: {
      0: { comment: "章节控制器", content: '<%- await getwi(null, "第一章") %>', constant: true },
      1: { comment: "第一章", content: "章节正文", disable: true },
      2: { comment: "普通设定", content: "普通正文", constant: true },
    } }), "sillytavern");
    expect(parsed.entries.find((item) => item.title === "章节控制器")).toMatchObject({
      dynamicMode: "standard",
      agentReadStrategy: "normal",
      contentMode: "ejs",
    });
    expect(parsed.entries.find((item) => item.title === "第一章")).toMatchObject({
      dynamicMode: "ejs_reference",
      agentReadStrategy: "normal",
      enabled: true,
    });
    expect(parsed.entries.find((item) => item.title === "普通设定")?.dynamicMode).toBe("standard");
  });
});
