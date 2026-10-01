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
      favoritePlayerId: v.optional(v.string()), // id of the user's favorite player (N/A if unset)
    })
      .index("email", ["email"]) // index for the email. do not remove or modify
      .index("by_username", ["username"]),

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
      // lastMatchPoints / totalPoints are derived from matchScores, see points.ts
      // One-time "Double Down" chip: armed for gw1 or gw2, consumed at settle.
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
      logoUrl: v.string(), // data URL or link
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

    // ===== System-level flags (singleton row) =====
    systemConfig: defineTable({
      isMaintenanceMode: v.boolean(),
    }),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
