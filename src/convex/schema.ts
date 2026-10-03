import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

export const HOUSES = ["Fire", "Earth", "Wind", "Water"] as const;
export const houseValidator = v.union(
  v.literal("Fire"),
  v.literal("Earth"),
  v.literal("Wind"),
  v.literal("Water"),
);
export type House = Infer<typeof houseValidator>;

export const POSITIONS = ["GK", "DEF", "MID", "FWD"] as const;
export const positionValidator = v.union(
  v.literal("GK"),
  v.literal("DEF"),
  v.literal("MID"),
  v.literal("FWD"),
);
export type Position = Infer<typeof positionValidator>;

// ── Player availability status labels (set by the Super Admin) ──────────
export const PLAYER_STATUS_LABELS = [
  "Expected to Start",
  "Sub",
  "Not Play",
] as const;
export const statusLabelValidator = v.union(
  ...PLAYER_STATUS_LABELS.map((s) => v.literal(s)),
);
export type PlayerStatusLabel = Infer<typeof statusLabelValidator>;

export const STAGES = [
  "semifinal1",
  "semifinal2",
  "third_place",
  "final",
  "group_stage",
] as const;
export const stageValidator = v.union(...STAGES.map((s) => v.literal(s)));
export type Stage = Infer<typeof stageValidator>;

export const MATCH_STATUSES = ["scheduled", "live", "completed"] as const;
export const matchStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("live"),
  v.literal("completed"),
);
export type MatchStatus = Infer<typeof matchStatusValidator>;

// user roles for the tournament + fantasy platform.
// "super_admin" = Zein, "moderator" = Cino, "manager" = standard user.
export const ROLES = {
  SUPER_ADMIN: "super_admin",
  MODERATOR: "moderator",
  MANAGER: "manager",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.SUPER_ADMIN),
  v.literal(ROLES.MODERATOR),
  v.literal(ROLES.MANAGER),
);
export type Role = Infer<typeof roleValidator>;

// status values for manager-submitted price change requests.
export const REQUEST_STATUSES = ["pending", "approved", "denied", "adjusted"] as const;
export const requestStatusValidator = v.union(
  ...REQUEST_STATUSES.map((s) => v.literal(s)),
);
export type RequestStatus = Infer<typeof requestStatusValidator>;

// ── Earned cosmetic rewards ────────────────────────────────────────────
//
// The manual-cash store is GONE: there is no `purchases` table, no price, no
// currency and no queue. Every cosmetic is earned through a gameweek podium or
// an in-game feat (see convex/rewards.ts). "Who granted it" is kept for audit
// so an admin override is always traceable.
export const COSMETIC_GRANT_VIAS = ["earned", "super_admin", "admin_grant"] as const;
export const cosmeticGrantViaValidator = v.union(
  ...COSMETIC_GRANT_VIAS.map((s) => v.literal(s)),
);
export type CosmeticGrantVia = Infer<typeof cosmeticGrantViaValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove

      // fantasy manager profile
      username: v.optional(v.string()), // unique sign-in name (managers + admins)
      teamName: v.optional(v.string()), // fantasy team display name
      profilePic: v.optional(v.string()), // optional profile photo (alias of image)
      // LEGACY budget fields. Every manager now shares ONE fixed $70m budget
      // (see FIXED_MANAGER_BUDGET in configDefaults.ts) — these are retained
      // only so existing rows stay readable and are IGNORED by every budget
      // calculation. Never write them from the app again.
      budget: v.optional(v.number()), // deprecated: legacy per-user budget
      customBudget: v.optional(v.number()), // deprecated: legacy admin override
      customBadge: v.optional(v.string()), // custom badge: star | gold_checkmark | fire | crown | shield | diamond | none
      // Custom manager title shown on the leaderboard. Gated behind the
      // "custom_title" store entitlement; a value here without the
      // entitlement is simply ignored by the UI.
      customTitle: v.optional(v.string()),
      // Public social handles, stored WITHOUT the leading "@" (normalised by
      // managers.updateProfile). Both optional and never rendered as anything
      // other than a handle — the client builds the URL from a fixed host, so
      // a stored value can never become an arbitrary link.
      instagram: v.optional(v.string()),
      tiktok: v.optional(v.string()),
      favoritePlayerId: v.optional(v.string()), // id of the user's favorite player (N/A if unset)
      // The house this manager SUPPORTS — a purely cosmetic, MANUAL
      // preference chosen from the profile settings panel.
      //
      // This is deliberately NOT derived from the squad. Previously the house
      // was tallied across the seven picks and displayed as "their house",
      // so a manager's identity silently changed whenever they made a
      // transfer. A stored preference cannot drift.
      //
      // Optional + a `houseValidator` (not a free string), so the value can
      // only ever be one of the four real houses. `undefined` means "not
      // chosen yet", which the UI renders as a neutral state rather than
      // silently defaulting to one. Only the profile editor writes this
      // field — saveSquad never touches it.
      supportedHouse: v.optional(houseValidator),
    })
      .index("email", ["email"]) // index for the email. do not remove or modify
      .index("by_username", ["username"])
      // Used by the reward engine to resolve the Super Admin account for the
      // GW1 podium roll-down rule. The Super Admin competes and ranks like
      // every other manager — this index just finds them cheaply.
      .index("by_role", ["role"]),

    // ===== Platform config (single row, singleton) =====
    config: defineTable({
      key: v.string(),
      value: v.any(),
    }).index("by_key", ["key"]),

    // ===== School players (starts empty; admins populate) =====
    players: defineTable({
      name: v.string(),
      house: houseValidator, // Fire | Earth | Wind | Water
      position: positionValidator, // GK | DEF | MID | FWD
      price: v.number(), // player value in $
      active: v.boolean(),
      // Loose per-player stats container (goals/assists/apps history, etc.) —
      // optional so inserting a player never fails over missing/extra stats.
      stats: v.optional(v.any()),
      // Optional custom player photo (URL or data URL) set by the Super Admin.
      image: v.optional(v.string()),
      // Optional availability label (Expected to Start | Sub | Not Play) set
      // by the Super Admin; absent = treated as "Expected to Start" in the UI.
      statusLabel: v.optional(statusLabelValidator),
    })
      .index("by_house", ["house"])
      .index("by_position", ["position"])
      .index("by_active", ["active"]),

    // ===== Fantasy squads: one manager picks 7 starters =====
    squads: defineTable({
      userId: v.id("users"),
      playerIds: v.array(v.id("players")), // exactly 7
      captainId: v.id("players"), // one of playerIds
      totalSpent: v.number(),
      // Selected 7-a-side shape, e.g. "2-3-1" (legacy squads have none and
      // infer their shape from the selected players).
      formation: v.optional(v.string()),
      // One-time "Double Down" chip: armed for gw1 or gw2, consumed at settle.
      //
      // EVERY MANAGER GETS EXACTLY ONE, for the whole tournament. There is no
      // way to buy more: the extra-chip store item has been deleted, so the
      // chip allocation is strictly equal and fair across all managers.
      activeChip: v.optional(v.string()),
      chipUsed: v.optional(v.boolean()),
    }).index("by_user", ["userId"]),

    // ===== Gameweek management (deadlines, locks, settle state) =====
    gameweeks: defineTable({
      stage: stageValidator, // one row per tournament stage
      deadlineAt: v.optional(v.number()), // epoch ms — transfers lock after
      locked: v.optional(v.boolean()), // manual lock by Super Admin
      settled: v.optional(v.boolean()), // gameweek scored & bonuses resolved
    }).index("by_stage", ["stage"]),

    // ===== Match result predictor (4 questions, +2 pts each) =====
    predictions: defineTable({
      userId: v.id("users"),
      stage: stageValidator, // predicted fixture
      pick: houseValidator, // house the manager thinks will win
      correct: v.optional(v.boolean()), // resolved at settle
      awarded: v.optional(v.number()), // bonus points actually granted
    })
      .index("by_user", ["userId"])
      .index("by_stage", ["stage"]),

    // ===== 1v1 manager H2H point wagers =====
    wagers: defineTable({
      challengerId: v.id("users"),
      opponentId: v.id("users"),
      stake: v.number(), // points transferred from loser to winner
      stage: stageValidator, // the gameweek the wager counts for
      status: v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("declined"),
        v.literal("cancelled"),
        v.literal("settled"),
      ),
      winnerId: v.optional(v.id("users")), // null on a tie (stake returned)
      settledAt: v.optional(v.number()),
    })
      .index("by_status", ["status"])
      .index("by_challenger", ["challengerId"])
      .index("by_opponent", ["opponentId"]),

    // ===== Community activity feed (sports-card style, denormalized) =====
    // Text is baked at log time so deleted users/players degrade to the
    // stored string instead of breaking the feed.
    activityEvents: defineTable({
      type: v.string(), // transfer | badge | chip | rank | result | deadline | wager | settled
      text: v.string(),
      ts: v.number(),
      actorUserId: v.optional(v.id("users")),
      house: v.optional(houseValidator),
    }).index("by_ts", ["ts"]),

    // ===== House logos (custom, super admin only) =====
    houseLogos: defineTable({
      house: houseValidator,
      // Convex STORAGE ID of the uploaded crest (the normal path). Kept short
      // on purpose — see MAX_DATA_URL_CHARS in convex/houses.ts: a Convex
      // document is capped at 1 MiB, so a base64 data URL pasted straight in
      // here is what used to blow up with a raw server error.
      storageId: v.optional(v.string()),
      // Only used for a LEGACY data-URL row or an external CDN link. Always
      // bounded by MAX_DATA_URL_CHARS / a http(s) allowlist before it is
      // written, so this field can never exceed the document limit.
      logoUrl: v.optional(v.string()),
      updatedAt: v.number(),
    }).index("by_house", ["house"]),

    // ===== Matches =====
    matches: defineTable({
      stage: stageValidator, // semifinal1 | semifinal2 | third_place | final
      homeHouse: houseValidator,
      awayHouse: houseValidator,
      homeGoals: v.number(),
      awayGoals: v.number(),
      status: matchStatusValidator, // scheduled | live | completed
      kickoffLabel: v.optional(v.string()),
      kickoffAt: v.optional(v.number()),
      createdAt: v.number(),
      // PotM player id
      potmPlayerId: v.optional(v.id("players")),

      // ── Penalty shootout / tie-breaker ──────────────────────────────
      // NOTE: the advancing house is stored as a `houseValidator` string,
      // NOT `v.id("houses")` — this project has no `houses` table (houses
      // are a 4-value union, `houseLogos` is the only house-keyed table).
      // A v.id() would be unsatisfiable at runtime.
      //
      // All fields are OPTIONAL so every pre-existing match row stays
      // valid without a backfill. `isKnockout` falls back to the stage via
      // isKnockoutMatch() in convex/penalties.ts, so old rows behave
      // correctly. The pair (home/awayPenaltiesScore) is a shootout
      // OUTCOME only — it never feeds player fantasy points.
      isKnockout: v.optional(v.boolean()),
      goesToPenalties: v.optional(v.boolean()),
      homePenaltiesScore: v.optional(v.number()),
      awayPenaltiesScore: v.optional(v.number()),
      penaltyWinnerId: v.optional(houseValidator),

      // ── Rich match-center metadata (all optional — safe defaults) ──
      matchDate: v.optional(v.string()), // display label e.g. "Fri 14 Nov, 6 PM"
      timelineEvents: v.optional(
        v.array(
          v.object({
            id: v.string(),
            type: v.string(), // "goal" | "yellow_card" | "red_card" | "sub"
            minute: v.number(),
            playerId: v.id("players"),
            playerName: v.string(),
            assistPlayerId: v.optional(v.id("players")),
            assistPlayerName: v.optional(v.string()),
            house: houseValidator,
          }),
        ),
      ),
      lineups: v.optional(
        v.object({
          homeStarters: v.array(v.id("players")), // up to 7 player ids
          awayStarters: v.array(v.id("players")),
        }),
      ),
      // Super Admin's pre-kickoff expectation (the "predicted" starting 7 per
      // house) — rendered on the match preview until the real lineup lands.
      expectedLineups: v.optional(
        v.object({
          homeStarters: v.array(v.id("players")), // up to 7 player ids
          awayStarters: v.array(v.id("players")),
          // Bench / substitutes. Convex validators cannot express an array
          // length cap, so the max-3 rule is enforced in convex/lineups.ts
          // (MAX_SUBSTITUTES) on every write path.
          homeSubs: v.optional(v.array(v.id("players"))),
          awaySubs: v.optional(v.array(v.id("players"))),
          homeFormation: v.optional(v.string()),
          awayFormation: v.optional(v.string()),
        }),
      ),
      playerRatings: v.optional(
        v.array(
          v.object({
            playerId: v.id("players"),
            playerName: v.string(),
            house: houseValidator,
            rating: v.number(), // 1.0 - 10.0
            goals: v.number(),
            assists: v.number(),
            saves: v.number(),
            yellowCards: v.number(),
            redCards: v.number(),
          }),
        ),
      ),
    })
      .index("by_stage", ["stage"])
      .index("by_status", ["status"]),

    // ===== Per-player stat lines inside one match =====
    matchPlayers: defineTable({
      matchId: v.id("matches"),
      playerId: v.id("players"),
      house: houseValidator, // denormalized from player at save time
      rating: v.optional(v.number()), // 1.0 - 10.0
      goals: v.number(),
      goalMinutes: v.optional(v.array(v.number())), // timestamps for the timeline
      assists: v.number(),
      yellowCards: v.number(),
      redCards: v.number(),
      ownGoals: v.number(),
      ownGoalMinutes: v.optional(v.array(v.number())),
      saves: v.number(),
      cleanSheet: v.boolean(),
      potm: v.boolean(),
      fantasyPoints: v.number(), // computed via scoring rules
    })
      .index("by_match", ["matchId"])
      .index("by_player", ["playerId"]),

    // ===== Points a squad earned from one completed match =====
    matchScores: defineTable({
      matchId: v.id("matches"),
      squadId: v.id("squads"),
      userId: v.id("users"),
      points: v.number(),
    })
      .index("by_match", ["matchId"])
      .index("by_user", ["userId"])
      .index("by_squad", ["squadId"]),

    // ===== Price change requests from managers (admins review) =====
    priceRequests: defineTable({
      userId: v.id("users"),
      username: v.optional(v.string()),
      playerId: v.id("players"),
      playerName: v.string(),
      currentPrice: v.number(),
      requestedPrice: v.number(),
      reason: v.string(),
      status: requestStatusValidator, // "pending" | "approved" | "denied" | "adjusted"
      decidedBy: v.optional(v.string()),
      decidedAt: v.optional(v.number()),
      finalPrice: v.optional(v.number()),
    })
      .index("by_status", ["status"])
      .index("by_player", ["playerId"])
      .index("by_user", ["userId"]),

    // ===== Photo removal requests from managers (Super Admin reviews) =====
    // Managers can flag a player photo as wrong/inappropriate. Approving a
    // request clears `players.image` in the same transaction, so the whole UI
    // falls back to the position-based jersey / initials avatar. `currentImage`
    // is a denormalized snapshot so the admin queue still shows what was
    // reported even if the photo was later changed or the player deleted.
    photoRequests: defineTable({
      userId: v.id("users"),
      username: v.optional(v.string()),
      playerId: v.id("players"),
      playerName: v.string(),
      currentImage: v.optional(v.string()), // the URL as it was when reported
      reason: v.string(), // optional to the manager, stored as "" when blank
      status: requestStatusValidator, // "pending" | "approved" | "denied"
      decidedBy: v.optional(v.string()),
      decidedAt: v.optional(v.number()),
    })
      .index("by_status", ["status"])
      .index("by_player", ["playerId"])
      .index("by_user", ["userId"]),// ===== In-app direct messages between managers =====
// One row per message. Threads are derived by querying both directions
    // (sender→recipient and recipient→sender), so there is no separate
    // conversation row to keep in sync.
    directMessages: defineTable({
      senderId: v.id("users"),
      recipientId: v.id("users"),
      // Trimmed and length-capped server-side (max 1000) — plain text only.
      text: v.string(),
      isRead: v.optional(v.boolean()), // absent == unread
      createdAt: v.number(), // epoch ms
    })
      .index("by_recipient", ["recipientId"])
      .index("by_sender", ["senderId"])
      .index("by_recipient_read", ["recipientId", "isRead"])
      .index("by_pair", ["senderId", "recipientId"]),

    // ===== Earned cosmetics, one row per user + cosmetic =====
// The single source of truth for "has this manager unlocked this cosmetic,
// is it equipped, and WHY did they earn it?". Nothing here can be bought —
// rows are written only by the reward engine (convex/rewards.server.ts) or by
// a Super Admin override.
//
// `via` is kept for audit so a manual admin grant is always distinguishable
// from a feat-earned unlock.
    cosmeticUnlocks: defineTable({
      userId: v.id("users"),
      cosmeticId: v.string(), // CosmeticId from rewards.ts
      unlockedAt: v.number(), // epoch ms
      unlockedBy: v.optional(v.string()), // username that granted it
      via: cosmeticGrantViaValidator, // earned | super_admin | admin_grant
      // The feat id that earned it (e.g. "golden_boot"). Absent for a manual
      // admin grant or a legacy unlock.
      featId: v.optional(v.string()),
      // The gameweek it was earned in (1 | 2). The GW1 podium sets 1.
      gameweek: v.optional(v.number()),
      // Only ONE cosmetic per slot may be equipped at a time; the server
      // clears the previous holder of the same slot on equip.
      equipped: v.optional(v.boolean()),
    })
      .index("by_user", ["userId"])
      .index("by_user_cosmetic", ["userId", "cosmeticId"])
      .index("by_cosmetic", ["cosmeticId"]),

    // ===== System-level flags + Super Admin customization (singleton row) =====
    // One row holds every global setting Zein can edit. Every field is
    // optional so a fresh database returns safe defaults rather than failing.
    systemConfig: defineTable({
      isMaintenanceMode: v.optional(v.boolean()),

      // ── Custom house names: { Fire: "Inferno", Earth: "Titans", ... } ──
      houseNames: v.optional(v.any()),

      // ── Award copy overrides: { tacticalGenius: { title, description }, ... }
      awardTitles: v.optional(v.any()),

      // ── Custom badge registry the Super Admin defines and can assign:
      //    { id: { emoji, label, tone } }
      badgeRegistry: v.optional(v.any()),

      // ── Per-manager budget overrides: { "<userId>": 70000000 }
      //    Capped at the fixed global budget; cleared by removing the key.
      budgetOverrides: v.optional(v.any()),

      // ── Tournament lifecycle ──
      tournamentEnded: v.optional(v.boolean()),
      tournamentEndedAt: v.optional(v.number()),

      // ── Year 12 celebration copy ──
      year12Message: v.optional(v.string()),

      // ── House branding: { Fire: { name, color, logoUrl, motto } } ──
      houses: v.optional(v.any()),

      // ── Award definitions incl. icons + point thresholds ──
      awards: v.optional(v.any()),

      // ── Budget & market rules (prices in plain dollars) ──
      marketRules: v.optional(v.any()),

      // ── Scoring rule matrix (overrides SCORING_RULES in points.ts) ──
      scoringRules: v.optional(v.any()),

      // ── UI text & branding ──
      uiText: v.optional(v.any()),

      // ── Master switch: false = squad builder is read-only for everyone ──
      editableSquads: v.optional(v.boolean()),

      // ── Maintenance screen copy ──
      maintenanceMessage: v.optional(v.string()),
    }),

    // ===== Super Admin audit log =====
    // Every privileged action is appended here so a misconfiguration can
    // always be traced back to who made it and when.
    auditLog: defineTable({
      ts: v.number(),
      actor: v.optional(v.string()), // username, baked so deleted admins survive
      actorUserId: v.optional(v.id("users")),
      category: v.optional(v.string()), // config | user | points | tournament | bulk | auth
      action: v.string(), // e.g. "set_house_names"
      target: v.optional(v.string()), // affected user / key / entity
      detail: v.optional(v.string()), // human-readable summary
    })
      .index("by_ts", ["ts"])
      .index("by_category", ["category"]),

    // ===== Manual point adjustments (bonus / penalty) =====
    // Kept separate from matchScores so the reason log survives a
    // "Reset All Points" and can be re-applied or audited independently.
    pointAdjustments: defineTable({
      userId: v.id("users"),
      points: v.number(), // positive = bonus, negative = penalty
      reason: v.string(),
      createdAt: v.number(),
      actor: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_created", ["createdAt"]),

    // ===== Tournament award snapshot (singleton row) =====
    // Rewritten by `recalculateAwards` after every match update, so awards
    // are served from storage (fast, consistent) instead of being recomputed
    // per read. The query still falls back to a live computation when no
    // snapshot exists yet, so a fresh DB is never blank.
    awards: defineTable({
      tacticalGeniusUserId: v.optional(v.id("users")),
      tacticalGeniusName: v.optional(v.string()),
      tacticalGeniusTeam: v.optional(v.string()),
      tacticalGeniusPoints: v.optional(v.number()),
      unluckyUserId: v.optional(v.id("users")),
      unluckyName: v.optional(v.string()),
      unluckyTeam: v.optional(v.string()),
      unluckyPoints: v.optional(v.number()),
      differentialUserId: v.optional(v.id("users")),
      differentialName: v.optional(v.string()),
      differentialTeam: v.optional(v.string()),
      differentialPoints: v.optional(v.number()),
      playerOfWeekId: v.optional(v.id("players")),
      playerOfWeekName: v.optional(v.string()),
      playerOfWeekHouse: v.optional(v.string()),
      playerOfWeekPoints: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
