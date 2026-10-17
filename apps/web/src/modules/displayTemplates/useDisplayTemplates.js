import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { failureAlreadyPublished } from "../../utils/swallowedFailure.js";
const empty = { status: 'idle', value: null, error: '' };
const noSubscribe = () => () => {};
const noSnapshot = () => empty;

export function useDisplayTemplates(characterId, model) {
  const subscribe = useCallback(listener => model ? model.subscribe((scope, ownerId) => {
    if (scope === 'selection' && ownerId === characterId) listener();
  }) : noSubscribe(), [model, characterId]);
  const getSnapshot = useCallback(() => characterId && model ? model.getSelectionSnapshot(characterId) : noSnapshot(), [model, characterId]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, noSnapshot);
  useEffect(() => { if (characterId && model) void model.readSelection(characterId).catch(failureAlreadyPublished); }, [characterId, model]);
  return snapshot;
}
