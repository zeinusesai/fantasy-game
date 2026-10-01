// Labels for wager gameweek selects (client-side copy of STAGE_LABELS for a
// tiny import surface). Kept separate so the dialog does not pull the whole
// fantasy lib into the wager bundle path.
export const GW_STAGES = ["semifinal1", "semifinal2", "third_place", "final"] as const;

export const STAGE_LABELS_FALLBACK: Record<string, string> = {
  semifinal1: "Gameweek 1 · Semifinal 1",
  semifinal2: "Gameweek 1 · Semifinal 2",
  third_place: "Gameweek 2 · 3rd Place",
  final: "Gameweek 2 · Final",
};
