import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Check, ChevronDown, Search, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Y11 PE Hub — the two mandatory onboarding fields, as shared components.
 *
 * Both are used in three places (signup, Profile, and the Super Admin panel),
 * so the list of sections and the search behaviour can never drift between
 * them. The section list is fetched from the server (`users.listSections`)
 * rather than hard-coded, which keeps one source of truth for what a valid
 * section is.
 */

/** The eight PE class sections, straight from the server. */
export function useSections(): readonly string[] {
  const result = useQuery(api.users.listSections);
  // The server returns the frozen SECTIONS tuple, so the local type stays
  // readonly and the eight sections are guaranteed identical everywhere.
  return useMemo<readonly string[]>(() => result ?? [], [result]);
}

/**
 * Section picker (Section A – Section H).
 *
 * `value` is the stored section or `null`; `onChange` always receives a
 * canonical value from the list, never free text. Rendered as a Popover +
 * Command rather than a native `<select>` so it matches the glass theme and
 * stays usable on touch screens.
 */
export function SectionPicker({
  value,
  onChange,
  disabled,
  placeholder = "Choose your PE section",
  id,
}: {
  value: string | null | undefined;
  onChange: (section: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}) {
  const sections = useSections();
  const [open, setOpen] = useState(false);
  const selected = typeof value === "string" && value !== "" ? value : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "glass-subtle hover:bg-white/10 w-full justify-between font-normal transition-all duration-300",
            !selected && "text-muted-foreground",
          )}
        >
          <span className="truncate">{selected ?? placeholder}</span>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      {/* z-50 keeps the list above the glass page surfaces. */}
      <PopoverContent
        align="start"
        className="glass-strong z-50 w-[--radix-popover-trigger-width] min-w-[200px] p-0"
      >
        <Command>
          <CommandList>
            <CommandEmpty>No sections available.</CommandEmpty>
            <CommandGroup>
              {sections.map((section) => (
                <CommandItem
                  key={section}
                  value={section}
                  onSelect={() => {
                    onChange(section);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      selected === section ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {section}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export type PickerPlayer = {
  _id: string;
  name: string;
  house: string;
  position: string;
  image?: string | null;
};

/**
 * Searchable favourite-player picker, linked directly to the `players` table.
 *
 * The list is filtered client-side across name, house and position, so typing
 * "gk" or a player's surname both narrow the roster. `allowClear` is only set
 * where clearing is legal — during onboarding it is omitted, because a
 * favourite player is mandatory there.
 */
export function FavoritePlayerPicker({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder = "Search the squad for your favourite",
  emptyLabel = "Choose your favourite player",
}: {
  value: string | null | undefined;
  onChange: (playerId: string) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const playersResult = useQuery(api.players.listPlayers);
  const players = useMemo<PickerPlayer[]>(
    () =>
      (playersResult ?? []).map((p) => ({
        _id: String(p._id),
        name: p.name,
        house: p.house,
        position: p.position,
        image: p.image ?? null,
      })),
    [playersResult],
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = typeof value === "string" && value !== "" ? value : null;
  const selectedPlayer = players.find((p) => p._id === selected) ?? null;

  // Filter on name + house + position so "mid", "fire" and a surname all work.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return players;
    return players.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.house.toLowerCase().includes(q) ||
        p.position.toLowerCase().includes(q),
    );
  }, [players, query]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // Reset the search each time so reopening always starts from the full
    // roster rather than the previous filter.
    if (!next) setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || players.length === 0}
          className={cn(
            "glass-subtle hover:bg-white/10 w-full justify-between font-normal transition-all duration-300",
            !selectedPlayer && "text-muted-foreground",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Star className="size-3.5 shrink-0 text-amber-300" />
            <span className="truncate">
              {selectedPlayer ? (
                selectedPlayer.name
              ) : players.length === 0 ? (
                "No players imported yet"
              ) : (
                emptyLabel
              )}
            </span>
          </span>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="glass-strong z-50 w-[--radix-popover-trigger-width] min-w-[240px] p-0"
      >
        <Command shouldFilter={false} className="w-full">
          <div className="border-border/60 flex items-center gap-2 border-b px-3">
            <Search className="size-3.5 shrink-0 opacity-60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="placeholder:text-muted-foreground h-9 w-full bg-transparent text-sm outline-none"
              autoComplete="off"
            />
          </div>
          {/* Bounded + scrollable so a 60-player roster never grows the popover
              off the bottom of the viewport. */}
          <CommandList className="max-h-64">
            <CommandEmpty>
              No player matches “{query}”.
            </CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="gap-2 text-muted-foreground"
                >
                  <Check
                    className={cn("size-4 shrink-0", !selected && "opacity-100", selected && "opacity-0")}
                  />
                  Clear selection
                </CommandItem>
              )}
              {filtered.map((p) => (
                <CommandItem
                  key={p._id}
                  value={p._id}
                  onSelect={() => {
                    onChange(p._id);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      selected === p._id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {p.position}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}