import {
  getAppearanceMode,
  listenAppearanceModeChanged,
} from "../api/appearanceApi.js";

export const DEFAULT_APPEARANCE_MODE = "light";
export const APPEARANCE_MODES = ["light", "dark", "system"];

export function normalizeAppearanceMode(mode) {
  return APPEARANCE_MODES.includes(mode) ? mode : DEFAULT_APPEARANCE_MODE;
}

export function resolveAppearanceMode(mode) {
  const normalized = normalizeAppearanceMode(mode);
  if (normalized !== "system") return normalized;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyAppearanceMode(mode) {
  if (globalThis.__ELECKOI_DSH_PLATFORM__) {
    const root = document.documentElement;
    const source = root.dataset.dsThemeSource;
    const resolved = document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light";
    root.dataset.appearanceMode = source === "system" ? "system" : resolved;
    root.dataset.theme = resolved;
    return { mode: root.dataset.appearanceMode, resolved };
  }

  const normalized = normalizeAppearanceMode(mode);
  const resolved = resolveAppearanceMode(normalized);
  const root = document.documentElement;

  root.dataset.appearanceMode = normalized;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;

  return { mode: normalized, resolved };
}

export async function initializeAppearanceMode() {
  if (globalThis.__ELECKOI_DSH_PLATFORM__) {
    const update = () => applyAppearanceMode();
    window.addEventListener("eleckoi:dsh-theme:state", update);
    update();
    return () => window.removeEventListener("eleckoi:dsh-theme:state", update);
  }

  let mode = DEFAULT_APPEARANCE_MODE;
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");

  const update = (nextMode) => {
    mode = normalizeAppearanceMode(nextMode);
    applyAppearanceMode(mode);
  };
  const handleSystemAppearanceChange = () => {
    if (mode === "system") applyAppearanceMode(mode);
  };

  media?.addEventListener?.("change", handleSystemAppearanceChange);

  try {
    update(await getAppearanceMode());
  } catch {
    update(DEFAULT_APPEARANCE_MODE);
  }

  let disposeSettings = () => {};
  try {
    disposeSettings = await listenAppearanceModeChanged(update);
  } catch {
    // The active mode is already applied; a future reload will retry the bridge.
  }

  return () => {
    disposeSettings();
    media?.removeEventListener?.("change", handleSystemAppearanceChange);
  };
}
