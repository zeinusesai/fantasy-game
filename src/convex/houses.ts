import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireSuperAdmin } from "./lib";
import { houseValidator, HOUSES } from "./schema";

/**
 * ── House crests ────────────────────────────────────────────────────────
 *
 * WHY THIS USES STORAGE INSTEAD OF A DATA URL
 * A Convex DOCUMENT is capped at 1 MiB. A ~1.4 MB crest file base64-encodes to
 * roughly 1.9 MB of text, which cannot fit in a `houseLogos` row — attempting
 * it surfaced as a raw, unhelpful `Server Error`. Uploads now go to Convex file
 * storage and only the short storage ID is written to the database, so the
 * document stays a few dozen bytes.
 *
 * `logoUrl` remains supported for (a) legacy data-URL rows already in the
 * database and (b) an externally hosted CDN link, but it is now bounded by
 * `MAX_DATA_URL_CHARS` — comfortably under the document limit — and validated
 * to http(s) / data:image only.
 */

/** Absolute ceiling for a data-URL logo. ~300 KB of text, well under 1 MiB. */
export const MAX_DATA_URL_CHARS = 300_000;
/** Convex storage ids are short lowercase alphanumerics. */
const MAX_STORAGE_ID_CHARS = 64;
/** Uploaded file size cap (2 MB), matching the player-photo limit. */
export const MAX_LOGO_BYTES = 2_000_000;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/**
 * Validate a storage id. TOTAL — any junk returns null rather than throwing,
 * so a tampered id can never reach `ctx.storage`.
 */
function safeStorageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_STORAGE_ID_CHARS) return null;
  return /^[a-z0-9]+$/i.test(trimmed) ? trimmed : null;
}

/**
 * Validate a raw logo string (legacy data URL or external CDN link).
 * TOTAL — returns null for anything unusable.
 *
 * Only `https?://` and `data:image/` survive, so a `javascript:` or
 * `data:text/html` payload can never reach an `<img src>`.
 */
export function validateLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) {
    return trimmed.length <= MAX_DATA_URL_CHARS ? trimmed : null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.length <= 2_000 ? trimmed : null;
  }
  return null;
}

/** Friendly, actionable copy for each rejection reason. */
function logoRejectionMessage(
  storageId: string | null,
  logoUrl: string | null,
): string {
  const fileTooBig =
    typeof logoUrl === "string" &&
    logoUrl.trim().length > MAX_DATA_URL_CHARS &&
    /^data:image\//i.test(logoUrl.trim());
  if (fileTooBig) {
    return `That image is too large to store. Please upload a crest under ~200 KB, or host it and paste the link.`;
  }
  if (logoUrl !== null) {
    return "Invalid logo — paste an https:// link or upload an image file.";
  }
  if (storageId !== null) {
    return "Invalid image reference — please re-upload the crest.";
  }
  return "Choose an image file to upload, or paste an https:// link.";
}

/** Custom crest URL for every house, resolved for direct use as an <img src>. */
export const listHouseLogos = query({
  args: {},
  handler: async (ctx) => {
    const map: Record<string, string | null> = {};
    for (const house of HOUSES) map[house] = null;
    try {
      const rows = await ctx.db.query("houseLogos").collect();
      for (const row of rows) {
        // Defensive: only a known house key is written to the map.
        if (!(row.house in map)) continue;
        // Preferred path: resolve the stored blob to a served URL.
        if (row.storageId) {
          const id = safeStorageId(row.storageId);
          if (id) {
            try {
              map[row.house] = await ctx.storage.getUrl(id);
              continue;
            } catch {
              // The blob was deleted out from under us — fall through to the
              // legacy field so the client can still fall back to the crest.
            }
          }
        }
        // Legacy data URL or external CDN link (already bounded when written).
        const legacy = validateLogoUrl(row.logoUrl ?? "");
        if (legacy) map[row.house] = legacy;
      }
    } catch {
      // Never bubble a storage hiccup into a rejected query — an empty map
      // renders the default themed crest for every house.
    }
    return map as Record<(typeof HOUSES)[number], string | null>;
  },
});

/**
 * Super Admin: mint a one-time upload URL for a house crest.
 *
 * The file is PUT straight to storage by the browser, so no image bytes ever
 * travel through a mutation argument (or into the database). This mirrors the
 * avatar upload flow in managers.ts.
 */
export const generateLogoUploadUrl = mutation({
  args: { fileType: v.string() },
  handler: async (ctx, { fileType }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can change a house crest.",
      );
    }
    if (
      !ALLOWED_TYPES.includes(fileType as (typeof ALLOWED_TYPES)[number])
    ) {
      throw new Error("Unsupported image type — use PNG, JPG, WEBP or GIF.");
    }
    try {
      return { url: await ctx.storage.generateUploadUrl() };
    } catch {
      throw new Error("Could not start the upload — please try again.");
    }
  },
});

/**
 * Super Admin: point a house at a crest.
 *
 * Exactly one of `storageId` (the normal path — an uploaded blob) or `logoUrl`
 * (an externally hosted https link, or a small legacy data URL) must be
 * supplied. Everything is validated and trimmed HERE, so a malformed payload
 * produces a clear message instead of a raw database exception.
 */
export const setHouseLogo = mutation({
  args: {
    house: houseValidator,
    /** Convex storage id from `generateLogoUploadUrl`. Preferred. */
    storageId: v.optional(v.string()),
    /** External https link (or a small data URL). */
    logoUrl: v.optional(v.string()),
  },
  handler: async (ctx, { house, storageId, logoUrl }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can change a house crest.",
      );
    }

    const id = safeStorageId(storageId);
    const url = validateLogoUrl(logoUrl);

    // Accept when EITHER field is usable; report the most specific reason.
    if (id === null && url === null) {
      throw new Error(logoRejectionMessage(storageId ?? null, logoUrl ?? null));
    }

    const now = Date.now();
    try {
      const existing = await ctx.db
        .query("houseLogos")
        .withIndex("by_house", (q) => q.eq("house", house))
        .unique();

      // A patch never carries the unset field, so switching between a storage
      // id and an external link cleanly clears the other one. `undefined`
      // REMOVES the field (Convex semantics); `null` is not assignable.
      const patch =
        id !== null
          ? ({ storageId: id, logoUrl: undefined, updatedAt: now } as const)
          : ({ storageId: undefined, logoUrl: url as string, updatedAt: now } as const);

      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert("houseLogos", {
          house,
          ...(id !== null ? { storageId: id } : {}),
          ...(url !== null ? { logoUrl: url } : {}),
          updatedAt: now,
        });
      }
      return { house, storageId: id, logoUrl: url, updatedAt: now };
    } catch (err) {
      // Re-throw our own clean validation messages untouched.
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not save the house crest — please try again.");
    }
  },
});

/**
 * Super Admin: remove a custom crest (and the stored blob) so the house falls
 * back to its themed default. Idempotent — clearing an already-default house
 * succeeds quietly instead of erroring.
 */
export const clearHouseLogo = mutation({
  args: { house: houseValidator },
  handler: async (ctx, { house }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can change a house crest.",
      );
    }
    try {
      const existing = await ctx.db
        .query("houseLogos")
        .withIndex("by_house", (q) => q.eq("house", house))
        .unique();
      if (!existing) return { cleared: false as const };

      // Delete the blob first; a missing blob must not block the row removal.
      const id = safeStorageId(existing.storageId);
      if (id) {
        try {
          await ctx.storage.delete(id);
        } catch {
          // Already gone — carry on and clear the row anyway.
        }
      }
      await ctx.db.delete(existing._id);
      return { cleared: true as const };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not clear the house crest — please try again.");
    }
  },
});