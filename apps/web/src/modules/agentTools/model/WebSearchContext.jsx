import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes';
import { DesktopError } from '@shared/foundation/DesktopError';
import { createContext, useContext } from 'react';

const WebSearchContext = createContext(null);

export function WebSearchProvider({ model, children }) {
  return <WebSearchContext.Provider value={model || null}>{children}</WebSearchContext.Provider>;
}

export function useWebSearchModel() {
  const model = useContext(WebSearchContext);
  if (!model) throw new DesktopError(ELECKOI_FAILURE_CODES.lifecycleNotReady, '联网搜索设置服务尚未接入 DSH Client。', { what: '联网搜索设置服务' });
  return model;
}
