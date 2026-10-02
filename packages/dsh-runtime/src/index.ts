export { DshDesktopPluginHost, resolveDshWebFrontendDirectory } from './desktopPluginHost'
export { ELECKOI_DESKTOP_BUNDLES, ELECKOI_INSTALL_ANCHOR, registerDesktopBundles } from './desktopPluginBundles'
export type { DshDesktopPluginHostOptions, DshDesktopPluginHostReady } from './desktopPluginHost'
export { projectDshTrajectory, readDshSessionLog, readDshTrajectory, removeDshSessionTree } from './trajectory'
export { rewindDshSession } from './sessionRewind'
export { editDshSessionMessage } from './sessionMessageEdit'
export { repairRequestContextLog, repairRequestContextLogs } from './sessionRequestContextRepair'
export { recoverSessionHistory } from './sessionHistoryRecovery'
export type {
  DshSessionEventRecord,
  DshSessionHeader,
  DshTrajectoryPage,
  DshTrajectoryReadOptions,
  DshTrajectoryRequest,
  DshTrajectoryRecord,
  DshTrajectoryRecordKind,
  DshTrajectoryRecordStatus
} from './trajectory'
export type {
  DshRequestContextItem,
  DshRequestContextKind,
  DshRequestContextRole
} from './requestContext'
