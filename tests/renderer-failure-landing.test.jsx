// @vitest-environment jsdom
// 判据来源：ADR 0002 决定 12 最后两条（`notes/eh-explore-renderer.md` §5：全仓源码 `unhandledRejection`
// 命中 0；§5.2 的 `WindowControls` 三条 `ipcRenderer.invoke` 拒绝没人接；§5.3 的插件 `save()`
// 从 `saveCurrentDraft` 逃逸到 `UnsavedChangesDialog.jsx:82` 的 `onClick`）。
// 落点：渲染层唯一的文案解析点 + `console.error` 诊断串（由 Electron 的 console-message 转发进主进程
// 日志），不新建 IPC 通道（ADR 0017 决定 7）。
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowControls = vi.hoisted(() => ({
  appWindow: { minimize: vi.fn(), maximizeToggle: vi.fn(), close: vi.fn() },
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
import { WindowControls } from "../apps/web/src/app/windows/shell/components/TitleBar.jsx";
import { installUnhandledFailureReporting } from "../apps/web/src/utils/failureText.js";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const UNTRUSTED = {
  isDSHRemoteError: true,
  code: "eleckoi/sender/untrusted",
  message: "拒绝来自非 ElecKoi DSH 页面进程的桌面调用。",
  details: { what: "https://example.invalid/" },
};

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

function watchUnhandledRejections() {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  return { rejections, stop: () => process.off("unhandledRejection", onRejection) };
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
  for (const mock of Object.values(windowControls.appWindow)) mock.mockReset();
  vi.restoreAllMocks();
});

describe("窗口控件的拒绝有落点", () => {
  it("最小化 / 最大化 / 关闭的拒绝都进 console.error 的诊断串（会被转发进主进程日志）", async () => {
    windowControls.appWindow.minimize.mockRejectedValue(UNTRUSTED);
    windowControls.appWindow.maximizeToggle.mockRejectedValue(UNTRUSTED);
    windowControls.appWindow.close.mockRejectedValue(UNTRUSTED);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const watch = watchUnhandledRejections();
    try {
      const container = await mount(<WindowControls />);

      await act(async () => {
        container.querySelector(".window-control-button.minimize").click();
        container.querySelector(".window-control-button.maximize").click();
        container.querySelector(".window-control-button.close").click();
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      const lines = spy.mock.calls.map(([line]) => line).join("\n");
      expect(spy).toHaveBeenCalledTimes(3);
      expect(lines).toContain("eleckoi/sender/untrusted");
      expect(lines).toContain("窗口最小化");
      expect(lines).toContain("窗口最大化");
      expect(lines).toContain("窗口关闭");
      expect(watch.rejections).toEqual([]);
    } finally {
      watch.stop();
    }
  });
});

describe("插件 section 的 save() 逃逸有落点", () => {
  it("拒绝留在保存确认对话框的失败面上，不逃成未处理拒绝", async () => {
    const watch = watchUnhandledRejections();
    try {
      const characterCatalog = {
        refresh: vi.fn().mockResolvedValue({ items: [{ id: "character-1", name: "角色甲" }] }),
        update: vi.fn(),
      };
      const owners = new Map();
      const handoff = (section, owner, fallback) => {
        owners.set(section, owner);
        return <div data-testid={`seat-${section}`}>{section === "card" ? fallback : null}</div>;
      };
      const container = await mount(<CharacterEditorWindow
        characterCatalog={characterCatalog}
        characterConfiguration={{}}
        renderCharacterEditorSection={handoff}
      />);

      // 切到「设定库」：这个 section 的控制器由插件注入（本仓无注册者，所以这里手工注入一个会拒绝的）。
      await act(async () => { container.querySelectorAll(".character-editor-navigation button")[1].click(); });
      await act(async () => {
        owners.get("lore").setController({ save: () => Promise.reject(IO_FAILURE), discard: () => {} });
        owners.get("lore").onDirtyChange(true);
      });

      // 脏状态里切 section → 弹保存确认；点「保存」走 saveCurrentDraft。
      await act(async () => { container.querySelectorAll(".character-editor-navigation button")[2].click(); });
      const saveButton = document.body.querySelector(".unsaved-changes-dialog .is-primary");
      expect(saveButton).not.toBeNull();
      await act(async () => { saveButton.click(); });

      const error = document.body.querySelector(".unsaved-changes-error");
      expect(error).not.toBeNull();
      expect(error.textContent).toContain("读取失败");
      expect(document.body.querySelector(".unsaved-changes-dialog")).not.toBeNull();
      expect(watch.rejections).toEqual([]);
    } finally {
      watch.stop();
    }
  });
});

describe("渲染层未处理拒绝的落点", () => {
  it("console.error 一条可检索的诊断串", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    installUnhandledFailureReporting(window);
    const event = new Event("unhandledRejection");
    event.reason = new Error("没有人接的失败");
    window.dispatchEvent(event);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("渲染层未处理的拒绝");
    expect(spy.mock.calls[0][0]).toContain("eleckoi-renderer-failure");
    expect(spy.mock.calls[0][0]).toContain("没有人接的失败");
  });
});
