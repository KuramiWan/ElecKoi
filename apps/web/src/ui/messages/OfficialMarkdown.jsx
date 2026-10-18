import { ELECKOI_FAILURE_CODES } from "@shared/contracts/errors/codes";
import { DesktopError } from "@shared/foundation/DesktopError";
import { createContext, useContext } from "react";

const MarkdownComponentContext = createContext(null);
const markdownLabels = Object.freeze({
  code: Object.freeze({
    copyLabel: "复制",
    copiedLabel: "已复制",
    toolbarLabels: Object.freeze({
      codeLabel: "代码",
      wrapLabel: "自动换行",
      unwrapLabel: "不换行",
    }),
  }),
  footnotes: "脚注",
});

export function OfficialMarkdownProvider({ component, children }) {
  return <MarkdownComponentContext.Provider value={component || null}>{children}</MarkdownComponentContext.Provider>;
}

export function OfficialMarkdown({ content, streaming = false }) {
  const MarkdownText = useContext(MarkdownComponentContext);
  if (!MarkdownText) throw new DesktopError(ELECKOI_FAILURE_CODES.lifecycleNotReady, "DSH 官方文字渲染组件未接入。", { what: "DSH 官方文字渲染组件" });
  return <div className="eleckoi-dsh-markdown">
    <MarkdownText text={content || ""} streaming={streaming} labels={markdownLabels} />
  </div>;
}
