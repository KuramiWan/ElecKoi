import { useMemo } from 'react';

export function useModelCapabilities(config, model = config?.model) {
  const option = config?.model_options?.find(item => item.id === model);
  return useMemo(() => ({
    provider: config?.id,
    source: option?.isUserAdded === true && !option?.reasoningEfforts ? 'explicit_profile' : 'catalog',
    reasoningEfforts: option?.reasoningEfforts && typeof option.reasoningEfforts === 'object'
      ? Object.keys(option.reasoningEfforts) : [],
  }), [config?.id, option]);
}
