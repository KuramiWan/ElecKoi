/**
 * 渲染层唯一文案解析点：`apps/web/src/utils/failureText.js`。
 *
 * 这条用例守四件设计约束：
 * 1. **每条码都有且只有一句用户说法**（逐码遍历，漏一条就红）——码表长大时这里是闸；
 * 2. 说法里**不出现码本身**、不出现 `undefined` / `null` 这类拼接事故；
 * 3. 认不出的码落到通用说法，但**原码留在详情里**（不吞证据）；
 * 4. 通道默认由码给，调用点**只能上调**，没有下调的位置。
 */
import { describe, expect, it } from "vitest";
import { ELECKOI_FAILURE_CODES, ELECKOI_FAILURE_CODE_LIST } from "@shared/contracts/errors/codes";
import { DesktopError } from "@shared/foundation/DesktopError";
import {
  FAILURE_CHANNELS,
  GENERIC_FAILURE_TEXT,
  defaultChannelOf,
  failureDetailLines,
  failureMessage,
  formatFailureDetails,
  resolveFailure,
  upgradeChannel,
} from "../../src/utils/failureText.js";

/** 造一个带指定码的产品失败。 */
function failureOf(code, details = {}) {
  return new DesktopError(code, "开发者诊断：这里写技术细节", details);
}

const ALL_CODES = Object.values(ELECKOI_FAILURE_CODES);

describe("每条码都有用户说法", () => {
  it.each(ALL_CODES)("%s 有专门的一句话", (code) => {
    const resolved = resolveFailure(failureOf(code));
    expect(resolved.text.trim()).not.toBe("");
    // 兜底码走"开发者诊断"那条分支，其余每条码都必须有自己的说法。
    if (code !== ELECKOI_FAILURE_CODES.internal) {
      expect(resolved.text).not.toBe(GENERIC_FAILURE_TEXT);
    }
  });

  it("说法里不出现码、字段名式的技术词或拼接事故", () => {
    for (const code of ALL_CODES) {
      const { text } = resolveFailure(failureOf(code));
      expect(text, code).not.toContain("eleckoi/");
      expect(text, code).not.toContain("undefined");
      expect(text, code).not.toContain("null");
      expect(text, code).not.toContain("[object");
      expect(text.trim().length, code).toBeGreaterThan(0);
    }
  });

  it("码清单与码表一一对应（漏新增的码会在这里体现）", () => {
    expect([...ELECKOI_FAILURE_CODE_LIST].sort()).toEqual([...ALL_CODES].sort());
  });
});

describe("参数化详情进句子", () => {
  it("找不到东西时带上名词短语", () => {
    expect(resolveFailure(failureOf(ELECKOI_FAILURE_CODES.lookupNotFound, { what: "角色分组" })).text)
      .toBe("找不到角色分组。");
  });

  it("前置动作说清该先做什么", () => {
    expect(resolveFailure(failureOf(ELECKOI_FAILURE_CODES.statePrecondition, { what: "打开一个聊天" })).text)
      .toBe("请先打开一个聊天。");
  });

  it("IO 失败带动作与路径", () => {
    expect(resolveFailure(failureOf(ELECKOI_FAILURE_CODES.ioFailed, { operation: "write", path: "/tmp/卡.json" })).text)
      .toBe("保存失败：/tmp/卡.json。");
  });

  it("不支持的说法同时覆盖格式、版本与能力", () => {
    expect(resolveFailure(failureOf(ELECKOI_FAILURE_CODES.inputUnsupported, { what: "文件夹嵌套" })).text)
      .toBe("不支持这个格式、版本或能力：文件夹嵌套。");
    expect(resolveFailure(failureOf(ELECKOI_FAILURE_CODES.inputUnsupported)).text)
      .toBe("不支持这个格式、版本或能力。");
  });

  it("详情缺失时仍给完整句子，不露出占位符", () => {
    const text = resolveFailure(failureOf(ELECKOI_FAILURE_CODES.conflictStaleRevision)).text;
    expect(text).toBe("内容已在别处被修改，请刷新后重试。");
  });
});

describe("认不出的码与裸失败", () => {
  it("未知码折兜底，但原码留在详情里，用户看到通用说法", () => {
    const resolved = resolveFailure({ isDSHRemoteError: true, code: "eleckoi/未来才有的码", message: "细节", details: {} });
    expect(resolved.code).toBe(ELECKOI_FAILURE_CODES.internal);
    expect(resolved.details).toEqual({ what: "eleckoi/未来才有的码" });
    expect(resolved.text).toBe(GENERIC_FAILURE_TEXT);
  });

  it("裸 Error 用它的 message（唯一能让用户知道发生了什么的东西）", () => {
    const resolved = resolveFailure(new Error("磁盘满了"));
    expect(resolved.code).toBe(ELECKOI_FAILURE_CODES.internal);
    expect(resolved.text).toBe("磁盘满了");
  });

  it("非 Error 的非空字符串失败也给人话", () => {
    expect(resolveFailure("网络断了").text).toBe("网络断了");
  });

  it("null / undefined 落通用说法，不抛", () => {
    for (const value of [null, undefined]) {
      expect(resolveFailure(value).text).toBe(GENERIC_FAILURE_TEXT);
    }
  });

  it("调用方说法只在给不出任何说法时使用", () => {
    expect(resolveFailure(null, { fallback: "保存失败" }).text).toBe("保存失败");
    expect(resolveFailure(new Error("磁盘满了"), { fallback: "保存失败" }).text).toBe("磁盘满了");
  });
});

describe("通道（严重度）只上不下", () => {
  it("码给默认通道：宿主/库/存储/来源类默认应用级，其余功能内", () => {
    const appLevel = [
      ELECKOI_FAILURE_CODES.pluginLoadFailed,
      ELECKOI_FAILURE_CODES.dbSchemaMismatch,
      ELECKOI_FAILURE_CODES.storageCorrupt,
      ELECKOI_FAILURE_CODES.senderUntrusted,
      ELECKOI_FAILURE_CODES.lifecycleDisposed,
    ];
    for (const code of ALL_CODES) {
      expect(defaultChannelOf(code), code).toBe(appLevel.includes(code) ? FAILURE_CHANNELS.app : FAILURE_CHANNELS.inline);
    }
  });

  it("调用点可以上调到应用级", () => {
    const resolved = resolveFailure(failureOf(ELECKOI_FAILURE_CODES.ioFailed), { upgradeTo: FAILURE_CHANNELS.app });
    expect(resolved.channel).toBe(FAILURE_CHANNELS.app);
  });

  it("不接受下调：传 inline 不会把应用级码藏成小字", () => {
    expect(upgradeChannel(FAILURE_CHANNELS.app, FAILURE_CHANNELS.inline)).toBe(FAILURE_CHANNELS.app);
    const resolved = resolveFailure(failureOf(ELECKOI_FAILURE_CODES.pluginLoadFailed), { upgradeTo: FAILURE_CHANNELS.inline });
    expect(resolved.channel).toBe(FAILURE_CHANNELS.app);
  });
});

describe("日志与详情", () => {
  it("诊断行自带码、开发者文案与参数化详情（看日志不用回查码表）", () => {
    const resolved = resolveFailure(failureOf(ELECKOI_FAILURE_CODES.ioFailed, { operation: "write", path: "/tmp/x" }));
    expect(resolved.diagnostic).toContain("eleckoi-renderer-failure");
    expect(resolved.diagnostic).toContain(ELECKOI_FAILURE_CODES.ioFailed);
    expect(resolved.diagnostic).toContain("开发者诊断");
    expect(resolved.diagnostic).toContain("operation: write");
    expect(resolved.diagnostic).toContain("path: /tmp/x");
  });

  it("详情逐条给出原始键（界面展示与复制用）", () => {
    const lines = failureDetailLines({ operation: "read", path: "/tmp/y", empty: undefined });
    expect(lines).toEqual([
      { key: "operation", label: "operation", value: "read" },
      { key: "path", label: "path", value: "/tmp/y" },
    ]);
    expect(formatFailureDetails({ operation: "read", path: "/tmp/y" })).toBe("operation: read；path: /tmp/y");
  });

  it("详情不是对象时给空数组，不抛", () => {
    for (const details of [null, undefined, 42, "text", [1, 2]]) {
      expect(failureDetailLines(details)).toEqual([]);
    }
  });

  it("failureMessage 与 resolveFailure().text 一致", () => {
    const failure = failureOf(ELECKOI_FAILURE_CODES.agentPresetNotFound);
    expect(failureMessage(failure)).toBe(resolveFailure(failure).text);
  });
});
