import { createContext, useContext, useSyncExternalStore } from 'react';

const NativeFrontendContext = createContext(null);
const missing = { getSnapshot: () => null, subscribe: () => () => {} };
export function NativeFrontendProvider({ connection, authorConnection, children }) {
  return <NativeFrontendContext.Provider value={{ connection, authorConnection }}>{children}</NativeFrontendContext.Provider>;
}

/** Optional Cordis service lifetimes are injected by the existing shell. */
export function useNativeFrontendServices() {
  const value = useContext(NativeFrontendContext);
  const connection = value?.connection || missing, author = value?.authorConnection || missing;
  return {
    service: useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot),
    authorRuntime: useSyncExternalStore(author.subscribe, author.getSnapshot, author.getSnapshot),
  };
}
