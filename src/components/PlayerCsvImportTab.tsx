import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  CircleX,
  FileUp,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  parsePlayersCsv,
  type CsvParseResult,
  type ParsedPlayerRow,
} from "@/lib/csvPlayers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Shown in the UI so the Super Admin knows exactly what to export. */
const SAMPLE = `Name,House,Position,Price
Taym,Earth,MID,13.5m
Mazin,Fire,DEF,10.5m
Adam Alkamal,Fire,MID,13.5m`;

type ImportResult = {
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: string[];
};

export function PlayerCsvImportTab() {
  const importPlayers = useMutation(api.admin.importPlayersFromCSV);
  const fileInput = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      toast.error("Please choose a .csv file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("That file is larger than 2 MB — please split it up.");
      return;
    }
    setResult(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const outcome = parsePlayersCsv(text);
      setParsed(outcome);
      const errors = outcome.issues.filter((i) => i.level === "error").length;
      if (outcome.rows.length === 0) {
        toast.error(
          errors > 0
            ? `No importable rows — ${errors} problem${errors === 1 ? "" : "s"} found.`
            : "No rows found in that file.",
        );
      } else {
        toast.success(
          `Parsed ${outcome.rows.length} player${outcome.rows.length === 1 ? "" : "s"}.`,
        );
      }
    } catch {
      toast.error("Could not read that file.");
    }
  }

  function reset() {
    setFileName(null);
    setParsed(null);
    setResult(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function runImport(rows: ParsedPlayerRow[]) {
    setBusy(true);
    try {
      const response = await importPlayers({
        players: rows.map((r) => ({
          name: r.name,
          house: r.house,
          position: r.position,
          price: r.price,
        })),
      });
      setResult(response);
      const { importedCount, updatedCount, skippedCount } = response;
      if (skippedCount > 0) {
        toast.warning(
          `${importedCount} added, ${updatedCount} updated, ${skippedCount} skipped.`,
        );
      } else {
        toast.success(`${importedCount} added, ${updatedCount} updated.`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "The import could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const rows = parsed?.rows ?? [];
  const warnings = parsed?.issues.filter((i) => i.level === "warning") ?? [];
  const errors = parsed?.issues.filter((i) => i.level === "error") ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="border-border/80 lg:col-span-1">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <FileUp className="text-primary size-4" /> Import players CSV
          </CardTitle>
          <CardDescription>
            Bulk-load the squad list. Existing players are matched by name and
            have their house, position and price refreshed — photos and
            recorded stats are never touched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFile(e.dataTransfer.files?.[0]);
            }}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border/70 bg-secondary/30"
            }`}
          >
            <Upload className="text-muted-foreground mx-auto mb-2 size-7" />
            <p className="text-sm font-semibold">Drop a .csv file here</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Header row: <code>Name,House,Position,Price</code>
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                Choose file
              </Button>
              {fileName && (
                <Button variant="ghost" onClick={reset} disabled={busy}>
                  Clear
                </Button>
              )}
            </div>
            {fileName && (
              <p className="text-muted-foreground mt-3 text-xs">{fileName}</p>
            )}
          </div>

          <div className="bg-secondary/40 space-y-2 rounded-xl p-3">
            <p className="text-xs font-bold uppercase tracking-widest">
              Example file
            </p>
            <pre className="text-muted-foreground overflow-x-auto text-[11px] leading-relaxed">
              {SAMPLE}
            </pre>
            <p className="text-muted-foreground text-[11px]">
              Prices accept <code>13.5m</code>, <code>£13.5</code> or{" "}
              <code>13.5</code>. Pipe (<code>|</code>), semicolon and tab
              delimiters work too. Names are auto-formatted to Title Case.
            </p>
          </div>

          <div className="text-muted-foreground flex items-start gap-2 text-xs">
            <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" />
            <span>
              Super-Admin only. Every import is written to the audit log, and
              nothing is ever deleted — bad rows are reported, not applied.
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4 lg:col-span-2">
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="font-display flex flex-wrap items-center gap-2 text-lg font-bold uppercase tracking-wide">
              Preview
              {rows.length > 0 && (
                <Badge className="border-primary/40 bg-primary/10 text-primary">
                  {rows.length} ready
                </Badge>
              )}
              {warnings.length > 0 && (
                <Badge className="border-amber-400/40 bg-amber-400/10 text-amber-300">
                  {warnings.length} warning{warnings.length === 1 ? "" : "s"}
                </Badge>
              )}
              {errors.length > 0 && (
                <Badge className="border-red-400/40 bg-red-400/10 text-red-300">
                  {errors.length} error{errors.length === 1 ? "" : "s"}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Review every row before anything is written to the players table.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!parsed && (
              <p className="text-muted-foreground text-sm">
                Choose a CSV file to see the parsed players here.
              </p>
            )}

            {parsed && rows.length === 0 && (
              <p className="text-muted-foreground text-sm">
                Nothing importable in this file — check the errors below.
              </p>
            )}

            {rows.length > 0 && (
              <div className="max-h-[420px] overflow-auto rounded-xl border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>House</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Line</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={`${r.line}-${r.name}`}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>{r.house}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{r.position}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {r.price}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right text-xs">
                          {r.line}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {parsed && parsed.issues.length > 0 && (
              <div className="max-h-52 space-y-1.5 overflow-auto rounded-xl border border-border/70 p-3">
                {parsed.issues.map((issue, i) => (
                  <p
                    key={`${issue.line}-${i}`}
                    className={`flex items-start gap-2 text-xs ${
                      issue.level === "error" ? "text-red-300" : "text-amber-300"
                    }`}
                  >
                    {issue.level === "error" ? (
                      <CircleX className="mt-0.5 size-3.5 shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    )}
                    <span>
                      <strong>Line {issue.line}</strong> · {issue.message}
                    </span>
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={rows.length === 0 || busy}
                onClick={() => void runImport(rows)}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Importing…
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 size-4" /> Import {rows.length}{" "}
                    player{rows.length === 1 ? "" : "s"}
                  </>
                )}
              </Button>
              {parsed?.headerFound === false && (
                <span className="text-muted-foreground text-xs">
                  No header detected — columns were read positionally.
                </span>
              )}
            </div>

            {result && (
              <div className="border-primary/40 bg-primary/5 space-y-1.5 rounded-xl border p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="text-primary size-4" /> Import complete
                </p>
                <p className="text-muted-foreground">
                  {result.importedCount} added · {result.updatedCount} updated ·{" "}
                  {result.skippedCount} skipped
                </p>
                {result.errors.length > 0 && (
                  <ul className="text-muted-foreground space-y-1 text-xs">
                    {result.errors.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}