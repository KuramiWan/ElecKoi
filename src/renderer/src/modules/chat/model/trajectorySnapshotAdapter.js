export function adaptTrajectorySnapshot(official, contexts, outcomes) {
  const abortedTurns = new Set(outcomes?.abortedTurns || []);
  return {
    ...official,
    eventNodes: official.eventNodes.filter((node) => node.source?.kind !== "plugin:eleckoi-request-projection"),
    requests: official.requests
      // DSH 0.2.0-rc.2 classifies a user-cancelled assistant attempt as an
      // error because Trajectory does not retain the turn/end abort reason.
      // Preserve completed work, but do not present the cancelled attempt as
      // a failed request.
      .filter((request) => !(request.purpose === "assistant"
        && request.status === "error"
        && abortedTurns.has(request.turn)))
      .map((request) => ({
        ...request,
        context: contexts?.[request.startSeq] ?? [],
      })),
  };
}
