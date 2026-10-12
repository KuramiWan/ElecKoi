const PRESET_MANAGER_WINDOW_NAME = "preset-manager";

export function openPresetManagerWindow(purpose) {
  const managerUrl = new URL(window.location.href);
  managerUrl.search = "?view=preset-manager";
  if (purpose === 'creator' || purpose === 'roleplay') managerUrl.searchParams.set('purpose', purpose);
  window.open(
    managerUrl.toString(),
    PRESET_MANAGER_WINDOW_NAME,
    "width=1500,height=1040",
  );
}
