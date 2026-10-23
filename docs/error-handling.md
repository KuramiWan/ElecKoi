# 错误处理协作声明

这份声明面向维护者与贡献者：新增失败怎么写、用户可见文案在哪产生、加一条码或一个日志动作按什么顺序。判据来源是 [ADR 0040](adr/0040-error-contract.md)；失败码、详情参数与用户文案见生成的[失败契约](error-contract.md)。下面的规则由 `pnpm check:error-contract` 执行，四条规则都是绝对值，没有豁免账本。

## 写失败的规则

1. **抛出必须带码。** 领域、宿主、客户端插件与运行时插件的 `throw` 使用 `DesktopError`（`packages/shared/src/foundation/DesktopError.ts`）或 `productFailure`（`packages/host/product-api/src/productFailure.ts`）产出的失败对象：失败码 + 开发者诊断 + 参数化详情。原中文句保留为开发者诊断，不要删——日志靠它定位；它不会出现在界面上。
2. **不拆失败信封。** 拿到带码的失败时原样传下去：`RemoteResult` 走 `unwrapOrFail`，客户端拆信封用 `throw result.error`。不要写 `new Error(result.error.message)`——那会把码与详情丢掉，是本线要消灭的主要形态。
3. **用户可见文案只在渲染层产生。** 宿主、领域与运行时插件不拼用户句子；界面用 `resolveFailure(failure, { fallback }).text`。文案表在 `apps/web/src/utils/failureTexts.js`，每条码必须有一句；码表长大不改变已有文案。
4. **空 catch 必须写明意图。** 处理体为空时只能写 `.catch(failureAlreadyPublished)`、`.catch(rejectionIsAwaitedElsewhere)`、`.catch(bestEffort)` 之一，或写非空处理体（例如 `reportFailure`）。`catch {}` 与只含注释的 catch 一律算裸吞。
5. **契约违例带 `issues`。** `eleckoi/contract/invalid-request` 与 `-response` 的详情必须是非空数组，元素带 `path` 与 `message`；否则用户不知道哪个字段不合要求。

## 新增或修改一条失败

| 步骤 | 改哪里 |
| --- | --- |
| 1. 加码 | `packages/shared/src/contracts/errors/codes.ts` |
| 2. 给详情形状 | `packages/shared/src/contracts/errors/details.ts`；参数名是闭集 `field` / `issues` / `path` / `operation` / `guard` / `what` / `expected` / `actual` |
| 3. 给用户文案 | `apps/web/src/utils/failureTexts.js`；兜底码 `eleckoi/internal` 除外（它回落开发者诊断） |
| 4. 重生成 | `pnpm generate:error-codes` 与 `pnpm generate:error-contract-doc` |
| 5. 验证 | `pnpm check:error-contract` 与相关测试 |

`packages/host/product-api/src/errorCodes.generated.ts` 与 `docs/error-contract.md` 是生成物，不要手改；改源后重跑第 4 步。加码是内部枚举的自由，改名才需要一次全局替换。

## 严重度

呈现通道默认由码给：`inline` 就地失败面（窗口留着，给重试），`app` 应用级对话框或窗口级提示。默认走应用级的只有不属于任何窗口或面板的失败（当前 5 条：`plugin/load-failed`、`db/schema-mismatch`、`storage/corrupt`、`sender/untrusted`、`lifecycle/disposed`）。

调用点只能上调 `upgradeTo: "app"`；解析函数的参数里没有下调方向。不要把应用级失败藏成就地的一行小字——「严重度是场景的属性，不是失败的属性」。

## 日志

一行读得完：动作键 + 失败码 + 开发者诊断 + 参数化详情 + 时间。动作键是有语义的操作名，在 `packages/shared/src/contracts/logActions.ts` 登记，不要用随机 id。

启动与正常退出各写一行（会话首尾由日志层负责）：日志里有 start 没 end，就是崩溃或强杀。日志自己写不了时降级为 stdout + 一条 stderr，不为它加界面提示。

## 不要做

- 不新建第二套失败类型、失败方言或运行时错误服务；失败只有一种形状，折叠只有一个出口。
- 新代码不抛 legacy 6 码（`DESKTOP_ERROR_CODES`，只保留为防御映射）；`AuthorApiError` 是作者脚本的方言，不并进契约。
- 不承诺第三方或 Android 按码实现：码表是内部枚举，不冻结、不对公开面承诺。
- 不给闸建豁免账本：四条规则都是绝对值，命中即失败。

## 由什么守着

- `pnpm check:error-contract`：禁止丢码、契约违例必须带 `issues`、空 catch 必须具名、不许裸抛；只看代码位置，作者脚本示例里的同样文本不算。
- `.github/PULL_REQUEST_TEMPLATE/desktop.md` 的错误契约勾选项。
- 评审按 [ADR 0040](adr/0040-error-contract.md) 的判据看。
