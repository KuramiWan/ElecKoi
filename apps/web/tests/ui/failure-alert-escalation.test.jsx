// @vitest-environment jsdom
/**
 * 应用级通道真的生效：默认走 `app` 通道的码经功能内失败面时**不留在角落**。
 *
 * 判据来源：User Story 10（应用级失败要能到达用户面前）。实现是
 * `utils/appFailureOutlet.js`（模块级订阅）+ `FailureAlert` 命中 `channel === "app"` 时
 * 交给出口，窗口把出口接到 `notify("error", resolved.text, resolved)` → `AppErrorDialog`。
 *
 * 三条约束（缺一条就是回归）：
 * 1. 应用级码经失败面被**升级**，本组件不渲染就地失败面；
 * 2. 升级过去的东西仍然带**码与详情**（对话框要显示的正是它们）；
 * 3. 普通功能内失败（如 `lookup/not-found`）仍就地渲染；没有窗口级出口时就地渲染兜底。
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ELECKOI_FAILURE_CODES } from "@shared/contracts/errors/codes";
import { DesktopError } from "@shared/foundation/DesktopError";
import { FailureAlert } from "../../src/ui/ui/FailureAlert.jsx";
import { subscribeAppFailure } from "../../src/utils/appFailureOutlet.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, container, unsubscribe;

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (unsubscribe) unsubscribe();
  root = null;
  container = null;
  unsubscribe = null;
  document.body.replaceChildren();
});

async function mountAlert(props) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<FailureAlert {...props} />));
  return container;
}

/** 按窗口挂载时的形状订阅，返回"窗口收到的东西"。 */
function subscribeWindow() {
  const received = [];
  unsubscribe = subscribeAppFailure((resolved) => received.push(resolved));
  return received;
}

describe("应用级失败经失败面升级到窗口级", () => {
  it("storage/corrupt 升级：就地失败面不渲染，窗口收到码、详情与用户句", async () => {
    const received = subscribeWindow();
    const view = await mountAlert({
      failure: new DesktopError(
        ELECKOI_FAILURE_CODES.storageCorrupt,
        "创作项目索引读不出来：index.json",
        { what: "创作项目索引" },
      ),
    });

    expect(view.querySelector('[role="alert"]')).toBeNull();
    expect(received).toHaveLength(1);
    expect(received[0].code).toBe(ELECKOI_FAILURE_CODES.storageCorrupt);
    expect(received[0].channel).toBe("app");
    expect(received[0].text).toBe("存储内容已损坏，读不出来：创作项目索引。");
    expect(received[0].details).toEqual({ what: "创作项目索引" });
    expect(received[0].diagnostic).toContain(ELECKOI_FAILURE_CODES.storageCorrupt);
  });

  it("普通 lookup/not-found 仍就地渲染，不升级", async () => {
    const received = subscribeWindow();
    const view = await mountAlert({
      failure: new DesktopError(ELECKOI_FAILURE_CODES.lookupNotFound, "找不到这个角色卡：card-a", { what: "角色卡" }),
    });

    const alert = view.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("找不到角色卡。");
    expect(alert?.getAttribute("data-failure-code")).toBe(ELECKOI_FAILURE_CODES.lookupNotFound);
    expect(received).toHaveLength(0);
  });

  it("调用点上调的失败同样升级（严重度只上不下）", async () => {
    const received = subscribeWindow();
    await mountAlert({
      failure: new DesktopError(ELECKOI_FAILURE_CODES.ioFailed, "读配置失败：config.json", { operation: "read", path: "config.json" }),
      upgradeTo: "app",
    });

    expect(received).toHaveLength(1);
    expect(received[0].code).toBe(ELECKOI_FAILURE_CODES.ioFailed);
    expect(received[0].channel).toBe("app");
  });

  it("没有窗口级出口时就地渲染：宁可显示在角落，也不让失败消失", async () => {
    const view = await mountAlert({
      failure: new DesktopError(ELECKOI_FAILURE_CODES.storageCorrupt, "库坏了", { what: "创作项目索引" }),
    });

    const alert = view.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("存储内容已损坏，读不出来：创作项目索引。");
    expect(alert?.textContent).toContain(ELECKOI_FAILURE_CODES.storageCorrupt);
  });
});
