import { IconCheckOutlineRegular, IconSendOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';

export {
  IconPlusOutlineRegular as DshPlusIcon,
  IconAgentPresetOutlineRegular as DshAgentPresetIcon,
  IconChevronDownOutlineRegular as DshChevronDownIcon,
  IconRefreshOutlineRegular as DshRefreshIcon,
  IconStopFillRegular as DshStopIcon,
  IconNewChatOutlineRegular as DshNewChatIcon,
  IconPanelLeftOutlineRegular as DshPanelLeftIcon,
  IconEllipsisOutlineRegular as DshEllipsisIcon,
  IconSearchOutlineRegular as DshSearchIcon,
  IconCloseOutlineRegular as DshCloseIcon,
  IconCloseFillRegular as DshCloseFillIcon,
  IconChevronRightOutlineRegular as DshChevronRightIcon,
  IconEditOutlineRegular as DshEditIcon,
  IconTrashOutlineRegular as DshTrashIcon,
  IconChevronDownOutlineRegular as DshToBottomIcon,
  IconCopyOutlineRegular as DshCopyIcon,
  IconUserOutlineRegular as DshUserIcon,
  IconDownloadOutlineRegular as DshDownloadIcon,
} from '@deepseek-ai/dsh-client-ui-primitives';

export function DshCheckIcon({ size = 14, className }) {
  return <IconCheckOutlineRegular size={size} className={className} />;
}

export function DshSendIcon({ size = 16, className }) {
  return <IconSendOutlineRegular size={size} className={className} />;
}
