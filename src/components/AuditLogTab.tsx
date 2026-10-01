import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollText, Search } from "lucide-react";

/**
 * Audit log viewer (Super Admin only).
 *
 * Every privileged action in the app writes an entry here, so a misconfigured
 * setting or a bad point override can always be traced back to who made it
 * and when. The backend query returns `[]` for non-admins, so this tab renders
 * an empty state rather than an error when access is missing.
 */

/** Colour per audit category so the log is scannable at a glance. */
const CATEGORY_STYLES: Record<string, string> = {
  config: "border-sky-400/40 bg-sky-400/15 text-sky-200",
  user: "border-violet-400/40 bg-violet-400/15 text-violet-200",
  points: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200",
  squad: "border-amber-400/40 bg-amber-400/15 text-amber-200",
  tournament: "border-rose-400/40 bg-rose-400/15 text-rose-200",
  bulk: "border-red-400/40 bg-red-400/15 text-red-200",
  auth: "border-teal-400/40 bg-teal-400/15 text-teal-200",
};

const ALL_CATEGORIES = "all";

/** `Date.now()` is never a valid stored timestamp, so guard the render. */
function formatTimestamp(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function AuditLogTab() {
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [term, setTerm] = useState("");

  const logsResult = useQuery(api.audit.getAuditLogs, {
    limit: 200,
    ...(category !== ALL_CATEGORIES ? { category } : {}),
  });
  const categoriesResult = useQuery(api.audit.getAuditCategories);

  // Safe fallbacks: `undefined` while loading and `[]` for non-admins both
  // render the same empty state instead of a crash.
  const logs = useMemo(() => {
    const rows = logsResult ?? [];
    return rows.map((row) => ({
      _id: row._id,
      ts: row.ts,
      actor: row.actor ?? "system",
      category: row.category ?? "config",
      action: row.action,
      target: row.target ?? null,
      detail: row.detail ?? null,
    }));
  }, [logsResult]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const c of categoriesResult ?? []) {
      if (typeof c === "string" && c.length > 0) seen.add(c);
    }
    for (const row of logs) seen.add(row.category);
    return [...seen].sort();
  }, [categoriesResult, logs]);

  const needle = term.trim().toLowerCase();
  const filtered = needle.length === 0
    ? logs
    : logs.filter((row) =>
        `${row.actor} ${row.action} ${row.target ?? ""} ${row.detail ?? ""}`
          .toLowerCase()
          .includes(needle),
      );

  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <ScrollText className="text-primary size-4" /> Audit log
        </CardTitle>
        <CardDescription>
          Every Super Admin action, newest first — settings changed, points overridden, accounts
          deleted. Use this to trace a misconfiguration back to its source.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <div className="grid gap-1.5">
            <Label htmlFor="audit-search">Search</Label>
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                id="audit-search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="actor, action, target or detail…"
                className="pl-8"
                maxLength={80}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="audit-category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {logsResult === undefined ? (
          <p className="text-muted-foreground py-6 text-center text-sm">Loading the audit trail…</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {logs.length === 0
              ? "No admin actions recorded yet — or your account doesn't have access to this log."
              : "No entries match that search."}
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-xs">
              Showing {filtered.length} of {logs.length} entries
              {needle.length > 0 ? " (filtered)" : ""}.
            </p>
            <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">When</TableHead>
                    <TableHead className="w-28">Actor</TableHead>
                    <TableHead className="w-24">Category</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="text-muted-foreground font-mono text-[11px] whitespace-nowrap">
                        {formatTimestamp(row.ts)}
                      </TableCell>
                      <TableCell className="font-semibold">{row.actor}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={CATEGORY_STYLES[row.category] ?? CATEGORY_STYLES.config}
                        >
                          {row.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.action}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {row.target ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                        {row.detail ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
