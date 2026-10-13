// @vitest-environment jsdom
/**
 * 宿主失败通知在**渲染层**的样子：文案来自唯一解析点，失败码与详情看得见。
 *
 * 判据来源：ADR 0002 决定 4/8（用户可见文案只有一个解析点，在渲染层；宿主侧不拼用户可见句子）、
 * 决定 12（错误对话框显示失败码 + 参数化详情 + 诊断尾部）、spec 决定 8 与用户故事 6；
 * 票 EH-11 的 G 项。
 *
 * 判据是**用户读到的东西**：一次宿主失败通知走完 `hostFailureNotice`（通知 → notice 载荷）与
 * `AppErrorDialog`（notice → 界面）之后，界面上出现的是解析点给的那句话、契约码与详情，
 * 而**不是**宿主那句固定中文。
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorDialog } from "../apps/web/src/ui/ui/AppErrorDialog.jsx";
import { resolveFailure } from "../apps/web/src/utils/failureText.js";
import { hostFailureNotice } from "../apps/web/src/utils/hostFailureNotice.js";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

/** 宿主送来的那个对象（`desktopHostFailureNoticeOf` 的产物，形状见 contracts/errors/ipc.ts）。 */
const HOST_FAILURE = {
  isDSHRemoteError: true,
  code: "eleckoi/io/failed",
  message: "DSH 插件宿主退出：1",
  details: { operation: "read", path: "D:/ElecKoi/logs/app.log" },
  stack: "at desktopPluginHostChild.ts:42:7",
  logPath: "D:/ElecKoi/logs/app.log",
};

/** 修复前宿主发的就是这一句：它**不是**解析点的产物，界面里不许再出现它。 */
const REMOVED_HOST_SENTENCE = "插件服务意外退出，请重新打开插件中心。";

const mounted = [];

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => { root.render(element); });
  return container;
}

afterEach(() => {
  while (mounted.length) {
    const { root, container } = mounted.pop();
    act(() => { root.unmount(); });
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("宿主失败通知 → 渲染层", () => {
  it("notice 载荷里的文案就是解析点给的那句话，失败对象原样带上", () => {
    const notice = hostFailureNotice(HOST_FAILURE);

    expect(notice.type).toBe("error");
    expect(notice.failure).toBe(HOST_FAILURE);
    expect(notice.message).toBe(resolveFailure(HOST_FAILURE).text);
  });

  it("对话框显示解析点的文案、契约码与参数化详情，不再显示宿主那句固定中文", async () => {
    const notice = { id: 1, ...hostFailureNotice(HOST_FAILURE) };
    await mount(<AppErrorDialog notices={[notice]} onDismiss={() => {}} />);

    // 对话框走 portal，挂在 document.body 上，不在容器里。
    const dialog = document.body.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(document.body.querySelector(".app-error-text")?.textContent).toBe(resolveFailure(HOST_FAILURE).text);
    expect(dialog?.textContent).toContain("eleckoi/io/failed");
    expect(dialog?.textContent).toContain("D:/ElecKoi/logs/app.log");
    expect(dialog?.textContent).not.toContain(REMOVED_HOST_SENTENCE);
  });

  it("识别不出的码仍以解析点的兜底说法呈现，原码不被吞", async () => {
    const unknown = { isDSHRemoteError: true, code: "eleckoi/未来/新码", message: "更新的宿主发来的失败" };
    await mount(<AppErrorDialog notices={[{ id: 2, ...hostFailureNotice(unknown) }]} onDismiss={() => {}} />);

    expect(document.body.querySelector(".app-error-text")?.textContent).toBe(resolveFailure(unknown).text);
    expect(document.body.querySelector('[role="alertdialog"]')?.textContent).toContain("eleckoi/未来/新码");
  });
});
