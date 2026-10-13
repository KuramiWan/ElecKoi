// @vitest-environment jsdom
// 判据来源：ADR 0002 决定 12 的第三处具体失败（`notes/eh-explore-renderer.md` §3：
// `CharacterImportDialog.jsx:21` 的 `onDiscard(...).catch(() => {})` 把放弃导入的失败丢掉，
// 对话框照常关闭——用户什么都看不到）。
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterImportDialog } from "../apps/web/src/modules/persona/components/CharacterImportDialog.jsx";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const PREVIEW = { token: "token-1", items: [{ id: "c1", name: "角色甲", importable: true, summary: "可导入", errorMessage: "" }] };

const mounted = [];

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => { root.render(element); });
  return container;
}

async function openPreview(container) {
  const file = new File(["{}"], "card.json", { type: "application/json" });
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  // fileBase64 走 FileReader（jsdom 是宏任务），所以等 footer 出现为止。
  for (let attempt = 0; attempt < 40 && !container.querySelector(".character-import-dialog footer"); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  expect(container.querySelector(".character-import-dialog footer"), container.textContent).not.toBeNull();
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  document.body.innerHTML = "";
});

describe("角色导入对话框的放弃导入失败出口", () => {
  it("onDiscard 被拒：失败留在已有的 role=alert 面里，且不静默关闭", async () => {
    const failure = {
      isDSHRemoteError: true,
      code: "eleckoi/io/failed",
      message: "丢弃导入失败",
      details: { operation: "delete", path: "/tmp/eleckoi/imports/token-1" },
    };
    const onDiscard = vi.fn().mockRejectedValue(failure);
    const onClose = vi.fn();
    const container = await mount(<CharacterImportDialog
      onClose={onClose}
      onImported={vi.fn()}
      onPrepare={vi.fn().mockResolvedValue(PREVIEW)}
      onDiscard={onDiscard}
    />);

    await openPreview(container);
    await act(async () => { container.querySelector(".character-import-dialog footer button").click(); });

    expect(onDiscard).toHaveBeenCalledWith("token-1");
    expect(onClose).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("删除失败");
    expect(alert.textContent).toContain("/tmp/eleckoi/imports/token-1");
  });

  it("onDiscard 成功：照常关闭，没有失败面", async () => {
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const container = await mount(<CharacterImportDialog
      onClose={onClose}
      onImported={vi.fn()}
      onPrepare={vi.fn().mockResolvedValue(PREVIEW)}
      onDiscard={onDiscard}
    />);

    await openPreview(container);
    await act(async () => { container.querySelector(".character-import-dialog footer button").click(); });

    expect(onDiscard).toHaveBeenCalledWith("token-1");
    expect(onClose).toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
