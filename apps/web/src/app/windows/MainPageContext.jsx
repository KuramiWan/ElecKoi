import { ELECKOI_FAILURE_CODES } from "@shared/contracts/errors/codes";
import { DesktopError } from "@shared/foundation/DesktopError";
import { createContext, useContext } from "react";

export const MainPageContext = createContext(null);

export function useMainPageView() {
  const view = useContext(MainPageContext);
  if (!view) throw new DesktopError(ELECKOI_FAILURE_CODES.internal, "主页面必须在 ElecKoi 窗口中渲染。", { what: "主页面上下文" });
  return view;
}
