/**
 * 渲染层动作日志（WP14）：一行一个动作阶段，经 console 交给主进程的 console-message 桥。
 *
 * 设计判据：关键路径的日志带语义操作名（动作语义键见 `packages/shared/src/contracts/logActions.ts`）。
 * 这里断言的是**外部行为**：console 上出现了几行、每行能不能解回动作键与阶段、失败行有没有码；
 * 不断言主进程那边怎么落盘（那是 `apps/desktop/tests/app-log.test.ts` 的事）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ELECKOI_FAILURE_CODES } from "@shared/contracts/errors/codes";
import { LOG_ACTIONS, LOG_ACTION_MESSAGE_MARKER } from "@shared/contracts/logActions";
import { DesktopError } from "@shared/foundation/DesktopError";
import { logAction, runLoggedAction } from "../../src/utils/logAction.js";

let info;
let error;

beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 把 console 收到的行解回记录（形状由 `parseActionLogMessage` 守，这里只做 JSON 解包）。 */
function records(spy) {
  return spy.mock.calls.map(([line]) => {
    expect(String(line).startsWith(`${LOG_ACTION_MESSAGE_MARKER} `)).toBe(true);
    return JSON.parse(String(line).slice(LOG_ACTION_MESSAGE_MARKER.length + 1));
  });
}

describe("渲染层动作日志", () => {
  it("开始 / 成功各写一行，带语义动作键与阶段", () => {
    logAction(LOG_ACTIONS.messageSend, "start");
    logAction(LOG_ACTIONS.messageSend, "success");

    const lines = records(info);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ action: LOG_ACTIONS.messageSend, phase: "start" });
    expect(lines[1]).toMatchObject({ action: LOG_ACTIONS.messageSend, phase: "success" });
    expect(lines[0].text).toContain(LOG_ACTIONS.messageSend);
    expect(error).not.toHaveBeenCalled();
  });

  it("失败一行里同时有动作键与契约码（验收判据）", () => {
    logAction(LOG_ACTIONS.characterExport, "failure", new DesktopError(
      ELECKOI_FAILURE_CODES.ioFailed,
      "写不进导出文件",
      { operation: "write", path: "/tmp/角色卡.json" }
    ));

    const lines = records(error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      action: LOG_ACTIONS.characterExport,
      phase: "failure",
      code: ELECKOI_FAILURE_CODES.ioFailed,
    });
    expect(lines[0].details).toEqual({ operation: "write", path: "/tmp/角色卡.json" });
    expect(lines[0].text).toContain(LOG_ACTIONS.characterExport);
    expect(lines[0].text).toContain(ELECKOI_FAILURE_CODES.ioFailed);
  });

  it("日志本身永不抛（失败对象再怪也只落一行错误）", () => {
    expect(() => logAction(LOG_ACTIONS.settingsSave, "failure", { weird: Symbol("x") })).not.toThrow();
  });
});

describe("runLoggedAction", () => {
  it("成功：开始 → 成功两行，返回原值", async () => {
    await expect(runLoggedAction(LOG_ACTIONS.presetSave, async () => "saved")).resolves.toBe("saved");

    expect(records(info).map(line => line.phase)).toEqual(["start", "success"]);
  });

  it("失败：开始 → 失败两行，失败行带码，原错误照旧抛出", async () => {
    const failure = new DesktopError(ELECKOI_FAILURE_CODES.characterNotFound, "角色卡不见了", { what: "角色卡" });

    await expect(runLoggedAction(LOG_ACTIONS.characterImport, async () => { throw failure; })).rejects.toBe(failure);
    expect(records(info).map(line => line.phase)).toEqual(["start"]);
    expect(records(error)).toHaveLength(1);
    expect(records(error)[0]).toMatchObject({
      action: LOG_ACTIONS.characterImport,
      phase: "failure",
      code: ELECKOI_FAILURE_CODES.characterNotFound,
    });
  });
});
