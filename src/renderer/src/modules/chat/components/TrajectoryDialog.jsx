import { useCallback, useMemo } from "react";
import { TrajectoryView as ProductTrajectoryView, zh } from "@eleckoi/dsh-client-trajectory/client";

const noop = () => {};

export function TrajectoryView({ renderSlot }) {
  return <section className="trajectory-host" aria-label="轨迹">
    {renderSlot?.("eleckoi.roleplay.trajectory", {
      component: SessionTrajectoryView,
      inspectCall: undefined,
      viewRequest: null,
      openView: noop,
      completeViewRequest: noop,
    })}
  </section>;
}

export function SessionTrajectoryView(props) {
  const official = props.useTrajectory((value) => value);
  const contexts = props.useProjection("eleckoiRequestContexts");
  const snapshot = useMemo(() => ({
    ...official,
    eventNodes: official.eventNodes.filter((node) => node.source?.kind !== "plugin:eleckoi-request-projection"),
    requests: official.requests.map((request) => ({
      ...request,
      context: contexts?.[request.startSeq] ?? [],
    })),
  }), [official, contexts]);
  const useTrajectory = useCallback((selector) => selector(snapshot), [snapshot]);
  const translate = useCallback((key, values = {}) => {
    let text = zh[key];
    if (!text) return props.t(key, values);
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  }, [props.t]);
  return <ProductTrajectoryView {...props} useTrajectory={useTrajectory} t={translate} />;
}
