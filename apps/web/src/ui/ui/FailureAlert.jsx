import { failureDetailLines, resolveFailure } from "../../utils/failureText.js";

/**
 * 就地失败面：一句话 + 失败码 + 参数化详情（+ 可选重试）。
 *
 * 判据来源：ADR 0002 决定 12（副窗口各自已有就地失败面，不补 toast；四处具体失败要接上失败面）、
 * spec 的 User Story 1/4（用户看到的是失败本身与可复制的详情，不是「角色不存在」）。
 * 文案与码的解析一律走 `apps/web/src/utils/failureText.js` 这个唯一解析点。
 */
export function FailureAlert({ failure, fallback, onRetry, retryLabel = "重试", codeLabel = "失败码", className = "" }) {
  const resolved = resolveFailure(failure, { fallback });
  const facts = failureDetailLines(resolved.details);

  return (
    <div className={`failure-alert${className ? ` ${className}` : ""}`} role="alert">
      <p className="failure-alert-text">{resolved.text}</p>
      <dl className="failure-alert-facts">
        <div className="failure-alert-fact">
          <dt>{codeLabel}</dt>
          <dd>{resolved.code}</dd>
        </div>
        {facts.map((fact) => (
          <div className="failure-alert-fact" key={fact.key}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {onRetry ? <button className="failure-alert-retry" type="button" onClick={onRetry}>{retryLabel}</button> : null}
    </div>
  );
}
