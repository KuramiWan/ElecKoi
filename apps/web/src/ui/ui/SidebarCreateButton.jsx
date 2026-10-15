import { Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { DshPlusIcon } from "../icons/dshComposerIcons.jsx";
import "../styles/sidebar-create-button.css";

export function SidebarCreateButton({ title, expanded, onClick, onPointerDown }) {
  return (
    <Tooltip label={title} side="bottom" delayMs={500}><button
      className="sidebar-create-button"
      type="button"
      aria-label={title}
      aria-expanded={typeof expanded === "boolean" ? expanded : undefined}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <DshPlusIcon size={16} />
    </button></Tooltip>
  );
}
