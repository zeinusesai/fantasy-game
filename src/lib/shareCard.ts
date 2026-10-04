// Y11 PE Hub — downloadable squad share card (Instagram/WhatsApp).
//
// Renders the manager's 7-a-side lineup onto an offscreen <canvas> (1080×1350,
// 4:5 — Instagram portrait) and triggers a PNG download. Fully defensive:
// any failure returns false so the UI can toast "sharing not supported"
// instead of crashing.

export type SharePlayer = {
  name: string;
  position: string;
  house: string;
  isCaptain?: boolean;
};

const HOUSE_COLORS: Record<string, string> = {
  Fire: "#e64530",
  Earth: "#2f9e44",
  Wind: "#f0a821",
  Water: "#2f7fe0",
};

function safeColor(house: string): string {
  return HOUSE_COLORS[house] ?? "#7c3aed";
}

function wrapName(name: string, max = 12): string {
  if (typeof name !== "string" || name.length === 0) return "?";
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * Generate + download the squad graphic. Returns false when the canvas API
 * is unavailable (very old browsers / SSR) or anything throws.
 */
export function downloadShareCard(opts: {
  teamName: string;
  username: string;
  players: SharePlayer[];
  captainId?: string | null;
  totalPoints?: number;
}): boolean {
  try {
    if (typeof document === "undefined") return false;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    const { teamName, username, players, totalPoints } = opts;
    const list = Array.isArray(players) ? players.slice(0, 7) : [];

    // ── Background ──
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, "#0b1220");
    bg.addColorStop(1, "#101a2e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle pitch stripes.
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 6; i++) {
      if (i % 2 === 0) ctx.fillRect(0, (canvas.height / 6) * i, canvas.width, canvas.height / 6);
    }
    ctx.globalAlpha = 1;

    // Center circle decoration.
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 260, 0, Math.PI * 2);
    ctx.stroke();

    // ── Header ──
    ctx.textAlign = "center";
    ctx.fillStyle = "#14b8a6";
    ctx.font = "bold 34px Arial";
    ctx.fillText("Y11 PE HUB — MY SQUAD", canvas.width / 2, 110);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 64px Arial";
    ctx.fillText(
      (teamName || "My Squad").slice(0, 24),
      canvas.width / 2,
      200,
    );
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "30px Arial";
    ctx.fillText(`@${(username || "manager").slice(0, 20)}`, canvas.width / 2, 252);

    if (typeof totalPoints === "number" && Number.isFinite(totalPoints)) {
      ctx.fillStyle = "#a78bfa";
      ctx.font = "bold 40px Arial";
      ctx.fillText(`${Math.max(0, Math.round(totalPoints))} PTS`, canvas.width / 2, 320);
    }

    // ── Formation rows: GK / DEF / MID / FWD ──
    const rows: Array<{ pos: string; slots: number }> = [
      { pos: "FWD", slots: 2 },
      { pos: "MID", slots: 2 },
      { pos: "DEF", slots: 2 },
      { pos: "GK", slots: 1 },
    ];
    const rowYs = [470, 700, 930, 1160];
    const playerByPos = new Map<string, SharePlayer[]>();
    for (const p of list) {
      const key = String(p.position ?? "").toUpperCase();
      if (!playerByPos.has(key)) playerByPos.set(key, []);
      playerByPos.get(key)!.push(p);
    }

    rows.forEach((row, ri) => {
      const group = playerByPos.get(row.pos) ?? [];
      const slots = Math.min(row.slots, Math.max(group.length, 1));
      const gap = 300;
      const startX = canvas.width / 2 - ((slots - 1) * gap) / 2;
      for (let i = 0; i < slots; i++) {
        const p = group[i];
        const x = startX + i * gap;
        const y = rowYs[ri];
        if (!p) {
          // Empty slot.
          ctx.strokeStyle = "rgba(255,255,255,0.25)";
          ctx.setLineDash([8, 8]);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, 72, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          continue;
        }
        const isCaptain = p.isCaptain === true;
        // Disc.
        ctx.beginPath();
        ctx.arc(x, y, 72, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(8,12,24,0.9)";
        ctx.fill();
        ctx.lineWidth = isCaptain ? 8 : 5;
        ctx.strokeStyle = isCaptain ? "#fbbf24" : safeColor(p.house);
        ctx.stroke();
        // Captain armband glow.
        if (isCaptain) {
          ctx.save();
          ctx.shadowColor = "#fbbf24";
          ctx.shadowBlur = 26;
          ctx.beginPath();
          ctx.arc(x, y, 72, 0, Math.PI * 2);
          ctx.strokeStyle = "#fbbf24";
          ctx.stroke();
          ctx.restore();
        }
        // Initials.
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 40px Arial";
        ctx.textBaseline = "middle";
        const initials = String(p.name ?? "?").slice(0, 2).toUpperCase();
        ctx.fillText(initials, x, y - (isCaptain ? 6 : 0));
        // Position / captain tag.
        ctx.font = "bold 20px Arial";
        ctx.fillStyle = isCaptain ? "#fbbf24" : "rgba(255,255,255,0.65)";
        ctx.fillText(isCaptain ? "(C)" : String(p.position ?? ""), x, y + 44);
        ctx.textBaseline = "alphabetic";
        // Name + house stripe.
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 26px Arial";
        ctx.fillText(wrapName(p.name), x, y + 130);
        ctx.fillStyle = safeColor(p.house);
        ctx.fillRect(x - 40, y + 146, 80, 6);
      }
    });

    // ── Footer ──
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "24px Arial";
    ctx.fillText(
      "Developed by Zein · Y11 PE Hub Fantasy",
      canvas.width / 2,
      canvas.height - 40,
    );

    // ── Download ──
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `y11-squad-${(username || "manager").replace(/[^a-z0-9_-]/gi, "").toLowerCase()}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  }
}
