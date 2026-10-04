/**
 * Y11 PE Hub — CSV parser for the Super-Admin "Import Players CSV" tool.
 *
 * Pure and dependency-free so it can be unit-tested and reused. The parser is
 * deliberately forgiving (teachers export these by hand) but never guesses
 * silently: anything it cannot map with certainty becomes a visible warning or
 * error row instead of a silently wrong import.
 *
 * Accepted header (comma, pipe, semicolon or tab delimited):
 *   Name,House,Position,Price
 */

export type CsvPosition = "GK" | "DEF" | "MID" | "FWD";

export type ParsedPlayerRow = {
  /** Row number in the source file, for error reporting. */
  line: number;
  name: string;
  house: string;
  position: CsvPosition;
  price: number;
};

export type CsvIssueLevel = "warning" | "error";

export type CsvParseIssue = {
  level: CsvIssueLevel;
  line: number;
  /** Player name when we could work one out, else the raw row text. */
  subject: string;
  message: string;
};

export type CsvParseResult = {
  rows: ParsedPlayerRow[];
  issues: CsvParseIssue[];
  delimiter: string;
  headerFound: boolean;
  /** Data lines seen in the file (excluding the header and blanks). */
  totalRows: number;
};



export const POSITION_OPTIONS: readonly CsvPosition[] = [
  "GK",
  "DEF",
  "MID",
  "FWD",
] as const;

export const HOUSE_OPTIONS = ["Fire", "Earth", "Wind", "Water"] as const;

/** House assigned when the House cell is missing entirely (with a warning). */
export const FALLBACK_HOUSE = "Fire";

const POSITION_ALIASES: Record<string, CsvPosition> = {
  gk: "GK",
  g: "GK",
  gk1: "GK",
  goalkeeper: "GK",
  keeper: "GK",
  def: "DEF",
  d: "DEF",
  defender: "DEF",
  def1: "DEF",
  mid: "MID",
  m: "MID",
  midfielder: "MID",
  mf: "MID",
  fwd: "FWD",
  f: "FWD",
  fw: "FWD",
  forward: "FWD",
  attacker: "FWD",
  st: "FWD",
  striker: "FWD",
};

/** Picks the delimiter that actually appears in the header line. */
export function detectDelimiter(headerLine: string): string {
  const candidates = [",", "|", ";", "\t"];
  let best = ",";
  let bestCount = 0;
  for (const c of candidates) {
    const count = headerLine.split(c).length - 1;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Title Case for roster names: "adam alkamal" → "Adam Alkamal".
 *
 * Words that already contain a capital (McDonald, O'Brien, ElGammal) are left
 * untouched rather than flattened, so a hand-corrected name is never mangled.
 */
export function toTitleCaseName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => {
      if (!word) return word;
      // Hyphenated names keep the same rule on each part.
      return word
        .split("-")
        .map((part) =>
          part && part === part.toLowerCase()
            ? part.charAt(0).toUpperCase() + part.slice(1)
            : part,
        )
        .join("-");
    })
    .join(" ");
}

/** Maps loose position input to the four stored codes, or null if unknown. */
export function normalizePosition(raw: string): CsvPosition | null {
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  return POSITION_ALIASES[key] ?? null;
}

/** Maps loose house input to a stored house, or null if unknown. */
export function normalizeHouse(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  return HOUSE_OPTIONS.find((h) => h.toLowerCase() === key) ?? null;
}

/**
 * Extracts the numeric price from "13.5m", "13.5M", "£13.5m", "$9,000", "13.5".
 * Returns null when there is no usable number.
 */
export function parsePrice(raw: string): number | null {
  const cleaned = raw
    .replace(/[$£€¥]/g, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** Splits one CSV line, honouring double-quoted fields. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((cell) => cell.trim());
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "player", "playername", "player name", "fullname", "full name"],
  house: ["house", "housename", "house name", "team", "tutor"],
  position: ["position", "pos", "role", "playingposition", "playing position"],
  price: ["price", "value", "cost", "pricecr", "price m", "price m", "value m"],
};

/**
 * Parses a whole CSV document into import-ready rows plus warnings/errors.
 * Never throws: a malformed file yields rows + issues, never an exception.
 */
export function parsePlayersCsv(text: string): CsvParseResult {
  const issues: CsvParseIssue[] = [];
  const rows: ParsedPlayerRow[] = [];

  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  if (lines.length === 0) {
    return {
      rows,
      issues: [
        { level: "error", line: 0, subject: "file", message: "The file is empty." },
      ],
      delimiter: ",",
      headerFound: false,
      totalRows: 0,
    };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = splitLine(lines[0], delimiter).map((c) =>
    c.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim(),
  );

  const columnFor = (field: keyof typeof HEADER_ALIASES): number => {
    const aliases = HEADER_ALIASES[field];
    return headerCells.findIndex((cell) => aliases.includes(cell));
  };

  const idx = {
    name: columnFor("name"),
    house: columnFor("house"),
    position: columnFor("position"),
    price: columnFor("price"),
  };

  // A header is recognised when we can find at least a name and a price
  // column; otherwise we fall back to positional Name,House,Position,Price.
  const headerFound = idx.name !== -1 && idx.price !== -1;
  const dataLines = headerFound ? lines.slice(1) : lines;

  if (!headerFound) {
    issues.push({
      level: "warning",
      line: 1,
      subject: "header",
      message:
        "No Name/Price header detected — reading columns as Name, House, Position, Price.",
    });
  }

  const cellAt = (cells: string[], column: number): string =>
    column >= 0 && column < cells.length ? cells[column] : "";

  const seenNames = new Set<string>();
  let totalRows = 0;

  for (let i = 0; i < dataLines.length; i++) {
    const lineNumber = headerFound ? i + 2 : i + 1;
    const cells = splitLine(dataLines[i], delimiter);
    totalRows++;

    const name = toTitleCaseName(
      cellAt(cells, headerFound ? idx.name : 0),
    );
    const rawHouse = cellAt(cells, headerFound ? idx.house : 1);
    const rawPosition = cellAt(cells, headerFound ? idx.position : 2);
    const rawPrice = cellAt(cells, headerFound ? idx.price : 3);

    if (!name) {
      issues.push({
        level: "error",
        line: lineNumber,
        subject: dataLines[i],
        message: "Missing player name — row skipped.",
      });
      continue;
    }

    const key = name.toLowerCase();
    if (seenNames.has(key)) {
      issues.push({
        level: "warning",
        line: lineNumber,
        subject: name,
        message: "Duplicate name inside the file — only the first row is imported.",
      });
      continue;
    }

    const position = normalizePosition(rawPosition);
    if (!position) {
      issues.push({
        level: "error",
        line: lineNumber,
        subject: name,
        message: rawPosition
          ? `Unrecognised position "${rawPosition}" (expected GK, DEF, MID or FWD) — row skipped.`
          : "Missing position — row skipped.",
      });
      continue;
    }

    const price = parsePrice(rawPrice);
    if (price === null) {
      issues.push({
        level: "error",
        line: lineNumber,
        subject: name,
        message: `Could not read a price from "${rawPrice || "(blank)"}" — row skipped.`,
      });
      continue;
    }
    if (price < 0) {
      issues.push({
        level: "error",
        line: lineNumber,
        subject: name,
        message: "Negative price — row skipped.",
      });
      continue;
    }

    let house = normalizeHouse(rawHouse);
    if (!house) {
      if (rawHouse) {
        issues.push({
          level: "error",
          line: lineNumber,
          subject: name,
          message: `Unrecognised house "${rawHouse}" (expected Fire, Earth, Wind or Water) — row skipped.`,
        });
        continue;
      }
      house = FALLBACK_HOUSE;
      issues.push({
        level: "warning",
        line: lineNumber,
        subject: name,
        message: `No house given — defaulted to ${FALLBACK_HOUSE}.`,
      });
    }

    seenNames.add(key);
    rows.push({ line: lineNumber, name, house, position, price });
  }

  return { rows, issues, delimiter, headerFound, totalRows };
}