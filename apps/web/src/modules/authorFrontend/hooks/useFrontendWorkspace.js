import { useNativeFrontendWorkspace } from './useNativeFrontendWorkspace.js';

export function useFrontendWorkspace(characterId) {
  return useNativeFrontendWorkspace('character', characterId);
}
