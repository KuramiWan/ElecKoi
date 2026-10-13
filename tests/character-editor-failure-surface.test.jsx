// @vitest-environment jsdom
// 判据来源：ADR 0002 决定 12 的第一处具体失败（`notes/eh-explore-renderer.md` §1 的逐行事实底座）。
// R1 用例本体在 tests/character-editor-plugin.test.jsx（本票一个字节都不改它）；本文件只补它没有覆盖的
// 两件事：①「列表读到了但没有这个 id」仍然是「角色不存在」，不许被失败面冒充；
// ②失败面带重试，重试能重新读取并把界面救回来。
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowControls = vi.hoisted(() => ({
  appWindow: { close: vi.fn() },
  showCurrentWindow: vi.fn(() => Promise.resolve()),
}));

vi.mock("../apps/web/src/modules/persona/index.js", () => ({
  CharacterBasicInfoPanel: ({ character }) => <div data-testid="built-in-card">{character.name}</div>,
}));
vi.mock("../apps/web/src/modules/appearance/index.js", () => ({ applyAppearanceTheme: () => {} }));
vi.mock("../apps/web/src/modules/settingLibraries/index.js", () => ({
  DynamicSettingsPanel: () => null,
  SettingLibraryPanel: () => null,
}));
vi.mock("../apps/web/src/modules/variables/index.js", () => ({ VariableConfigPanel: () => null }));
vi.mock("../apps/web/src/modules/regex/index.js", () => ({ RegexRulesPanel: () => null }));
vi.mock("../apps/web/src/app/services/windowControls.js", () => windowControls);

import { CharacterEditorWindow } from "../apps/web/src/app/windows/CharacterEditorWindow.jsx";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const IO_FAILURE = {
  isDSHRemoteError: true,
  code: "eleckoi/io/failed",
  message: "读取角色列表失败：ENOENT",
  details: { operation: "read", path: "/tmp/eleckoi/characters.json" },
};

const mounted = [];

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => { root.render(element); });
  return container;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/?view=character-editor&character=character-1");
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("CharacterEditorWindow 的读取失败面", () => {
  it("列表读到了但没有这个 id：仍说角色不存在，不冒充读取失败", async () => {
    const characterCatalog = { refresh: vi.fn().mockResolvedValue({ items: [{ id: "other", name: "别的角色" }] }), update: vi.fn() };
    const container = await mount(<CharacterEditorWindow characterCatalog={characterCatalog} characterConfiguration={{}} />);

    expect(container.textContent).toContain("角色不存在");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("失败面带失败码与参数化详情，点重试重新读取并恢复", async () => {
    const characterCatalog = {
      refresh: vi.fn().mockRejectedValueOnce(IO_FAILURE).mockResolvedValue({ items: [{ id: "character-1", name: "角色甲" }] }),
      update: vi.fn(),
    };
    const container = await mount(<CharacterEditorWindow characterCatalog={characterCatalog} characterConfiguration={{}} />);

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("读取失败");
    expect(alert.textContent).toContain("eleckoi/io/failed");
    expect(alert.textContent).toContain("/tmp/eleckoi/characters.json");
    expect(container.textContent).not.toContain("角色不存在");

    await act(async () => { container.querySelector(".failure-alert-retry").click(); });

    expect(characterCatalog.refresh).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-testid="built-in-card"]')?.textContent).toBe("角色甲");
  });
});
