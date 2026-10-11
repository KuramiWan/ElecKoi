import { useNativeFrontendWorkspace } from './useNativeFrontendWorkspace.js';

export function useApplicationFrontendWorkspace() {
  return useNativeFrontendWorkspace('application');
}
