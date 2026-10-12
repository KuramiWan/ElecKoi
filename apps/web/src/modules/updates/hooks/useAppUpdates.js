import { useCallback, useEffect, useMemo, useState } from "react";
const updateService = android => android ? window.ElecKoiPlatform?.updates : window.dshDesktop?.updates;
export function useAppUpdates() {
  const android = globalThis.__ELECKOI_CLIENT_PLATFORM__?.kind === "android";
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let connected, unsubscribe;
    const attach = () => {
      const updates = updateService(android);
      if (!updates) { if (!android) setError("更新服务暂时不可用。"); return; }
      if (connected === updates) return;
      unsubscribe?.(); connected = updates;
      unsubscribe = updates.subscribe((nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        setError("");
      });
      void updates.status().then((nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        setError("");
      }).catch((cause) => {
        if (active) setError(cause?.message || "无法读取版本信息。");
      });
    };
    if (android) window.addEventListener('eleckoi:platform-ready', attach);
    attach();
    return () => {
      active = false;
      unsubscribe?.();
      window.removeEventListener('eleckoi:platform-ready', attach);
    };
  }, [android]);

  const requestStatus = useCallback(async (request) => {
    setError("");
    try {
      const nextStatus = await request();
      setStatus(nextStatus);
      return nextStatus;
    } catch (cause) {
      setError(cause?.message || "更新服务暂时不可用。");
      throw cause;
    }
  }, []);

  const check = useCallback(() => requestStatus(() => {
    const updates = updateService(android);
    if (!updates) throw new Error("更新服务暂时不可用。");
    return updates.check();
  }), [android, requestStatus]);
  const download = useCallback(() => requestStatus(() => {
    const updates = updateService(android);
    if (!updates) throw new Error("更新服务暂时不可用。");
    return updates.download();
  }), [android, requestStatus]);
  const install = useCallback(async () => {
    setError("");
    try {
      const updates = updateService(android);
      if (!updates?.install) throw new Error("更新安装服务暂时不可用。");
      return await updates.install();
    } catch (cause) {
      setError(cause?.message || "无法启动安装。");
      throw cause;
    }
  }, [android]);

  return useMemo(() => ({ status, error, check, download, install }), [check, download, error, install, status]);
}
