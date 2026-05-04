import { useRef, useState, useEffect, useMemo } from "react";
import { CurrentUser } from "../api/auth";
import { listEntries } from "../api/files";
import { useActiveContext } from "../lib/context";
import { getActions } from "../lib/actions";
import { useContextMenu } from "../lib/contextMenu";
import { pathToDisplayTitle, cx } from "../lib/utils";
import type { ContextMenuItem } from "./ContextMenu";
import type { Action } from "../lib/actions";
import { Search } from "../icons";
import ProfileModal from "./modals/ProfileModal";
import AdminModal from "./modals/AdminModal";
import styles from "./CommandBar.module.css";

// ── Fuzzy match ────────────────────────────────────────────────────────────

function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  for (const c of n) {
    const idx = h.indexOf(c, hi);
    if (idx === -1) return false;
    hi = idx + 1;
  }
  return true;
}

async function listAllFilePaths(path: string): Promise<string[]> {
  const entries = await listEntries(path).catch(() => []);
  const paths: string[] = [];
  await Promise.all(
    entries.map(async (e) => {
      if (e.kind === "file") {
        paths.push(e.path);
      } else {
        paths.push(...(await listAllFilePaths(e.path)));
      }
    }),
  );
  return paths;
}

// ── Types ──────────────────────────────────────────────────────────────────

type Modal = "profile" | "admin" | null;

type PaletteItem =
  | { kind: "action"; action: Action }
  | { kind: "file"; path: string; displayLabel: string };

interface Section {
  label: string | null;
  items: PaletteItem[];
}

interface DropdownPos {
  top: number;
  left: number;
  width: number;
}

export interface CommandBarProps {
  user: CurrentUser;
  onLogout: () => void;
  onUserUpdated: (user: CurrentUser) => void;
  onOpenFile: (path: string) => void;
  reloadKey: number;
  hasActiveFile: boolean;
  isDirty: boolean;
  editorTitle: string | null;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CommandBar({
  user,
  onLogout,
  onUserUpdated,
  onOpenFile,
  reloadKey,
  hasActiveFile,
  isDirty,
  editorTitle,
}: CommandBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const commandBarRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);

  const { ctx } = useActiveContext();
  const openCtx = useContextMenu();

  useEffect(() => {
    listAllFilePaths("/").then(setAllFiles).catch(() => {});
  }, [reloadKey]);

  function openModal(m: Modal) {
    setModal(m);
  }

  function openPalette() {
    if (commandBarRef.current && inputWrapRef.current) {
      const wrapRect = inputWrapRef.current.getBoundingClientRect();
      setDropdownPos({ top: wrapRect.bottom, left: wrapRect.left, width: wrapRect.width });
    }
    listAllFilePaths("/").then(setAllFiles).catch(() => {});
    setOpen(true);
    setQuery("");
    setSelected(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function closePalette() {
    setOpen(false);
    setQuery("");
    setSelected(0);
    inputRef.current?.blur();
  }

  // Ctrl+Shift+P / Cmd+Shift+P global shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "p") {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const sections = useMemo((): Section[] => {
    if (!open) return [];
    const actions = getActions();

    if (!query) {
      const editorActions = hasActiveFile
        ? actions.filter((a) => a.contexts?.includes("editor"))
        : [];
      const otherActions = actions.filter((a) => !a.contexts?.includes("editor"));
      const result: Section[] = [];
      if (editorActions.length > 0) {
        result.push({ label: null, items: editorActions.map((a) => ({ kind: "action", action: a })) });
      }
      if (otherActions.length > 0) {
        result.push({ label: null, items: otherActions.map((a) => ({ kind: "action", action: a })) });
      }
      return result;
    }

    const matchAction = (a: Action) =>
      fuzzyMatch(a.label, query) || a.keywords?.some((k) => fuzzyMatch(k, query));

    const matched = actions.filter(matchAction);
    const ctxActions = matched.filter((a) => ctx && a.contexts?.includes(ctx));
    const otherActions = matched.filter((a) => !ctx || !a.contexts?.includes(ctx));

    const matchedFiles = allFiles
      .filter((p) => fuzzyMatch(p, query) || fuzzyMatch(pathToDisplayTitle(p), query))
      .slice(0, 8);

    const result: Section[] = [];
    if (ctxActions.length + otherActions.length > 0) {
      result.push({
        label: "Actions",
        items: [...ctxActions, ...otherActions].map((a) => ({ kind: "action", action: a })),
      });
    }
    if (matchedFiles.length > 0) {
      result.push({
        label: "Files",
        items: matchedFiles.map((p) => ({ kind: "file", path: p, displayLabel: pathToDisplayTitle(p) })),
      });
    }
    return result;
  }, [open, query, ctx, allFiles, hasActiveFile]);

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  const itemIndex = useMemo(() => {
    const m = new Map<PaletteItem, number>();
    flatItems.forEach((item, i) => m.set(item, i));
    return m;
  }, [flatItems]);

  useEffect(() => { setSelected(0); }, [flatItems]);

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); closePalette(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, flatItems.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[selected];
      if (!item) return;
      if (item.kind === "action") { item.action.handler(); closePalette(); }
      else { onOpenFile(item.path); closePalette(); }
    }
  }

  function userMenuItems(): ContextMenuItem[] {
    return [
      { type: "item", label: "Profile", onClick: () => openModal("profile") },
      ...(user.is_admin ? [{ type: "item" as const, label: "Administration", onClick: () => openModal("admin") }] : []),
      { type: "separator" },
      { type: "item", label: "Sign out", onClick: onLogout },
    ];
  }

  function openUserMenu(e: React.MouseEvent) {
    openCtx(e, userMenuItems(), "top-to-element-bottom", "right-to-element-right");
  }

  const contextChips = !hasActiveFile ? [] :
    getActions()
      .filter((a) => a.contexts?.includes("editor") && (a.id !== "core:discard" || isDirty))
      .slice(0, 4);

  return (
    <>
      <div className={cx(styles.commandBar, open && styles.isOpen)} ref={commandBarRef}>
        <div className={cx(styles.commandInputWrap, open && styles.isOpen)} ref={inputWrapRef}>
          <Search size={14} className={styles.commandInputSearchIcon} />
          <input
            ref={inputRef}
            className={cx(styles.commandInput, open && styles.isOpen)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (!open) openPalette(); }}
            onKeyDown={handleInputKeyDown}
            placeholder={open ? "Search or run a command…" : (editorTitle || "Search or run a command…")}
            autoComplete="off"
            spellCheck={false}
          />
          {!open && contextChips.length > 0 && (
            <div className={styles.commandChips}>
              {contextChips.map((a) => (
                <button
                  key={a.id}
                  className={styles.commandChip}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); a.handler(); }}
                  title={a.label}
                >
                  {a.icon && <a.icon size={12} />}
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* User menu on the right */}
        <div className={styles.userMenu}>
          <button
            className={styles.userMenuTrigger}
            onClick={(e) => openUserMenu(e)}
            onContextMenu={(e) => openUserMenu(e)}
          >
            {user.display_name}
          </button>
        </div>
      </div>

      {/* Transparent backdrop — captures clicks outside to close */}
      {open && <div className={styles.commandBackdrop} onMouseDown={closePalette} />}

      {/* Dropdown positioned below the input bar */}
      {open && dropdownPos && (
        <div
          className={styles.commandDropdown}
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {flatItems.length === 0 ? (
            <div className={styles.paletteEmpty}>No results</div>
          ) : (
            sections.map((section, si) => (
              <div key={si}>
                {si > 0 && <div className={styles.paletteSeparator} />}
                {section.label && <div className={styles.paletteSectionLabel}>{section.label}</div>}
                {section.items.map((item) => {
                  const idx = itemIndex.get(item) ?? 0;
                  const isSel = idx === selected;
                  if (item.kind === "action") {
                    return (
                      <button
                        key={item.action.id}
                        className={cx(styles.paletteResult, isSel && styles.isSelected)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { item.action.handler(); closePalette(); }}
                        onMouseEnter={() => setSelected(idx)}
                      >
                        {item.action.icon && <item.action.icon size={14} />}
                        <span className={styles.paletteResultLabel}>{item.action.label}</span>
                      </button>
                    );
                  }
                  return (
                    <button
                      key={item.path}
                      className={cx(styles.paletteResult, isSel && styles.isSelected)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { onOpenFile(item.path); closePalette(); }}
                      onMouseEnter={() => setSelected(idx)}
                    >
                      <span className={styles.paletteResultLabel}>{item.displayLabel}</span>
                      <span className={styles.paletteResultPath}>{item.path}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}

      {modal === "profile" && (
        <ProfileModal
          user={user}
          onClose={() => setModal(null)}
          onUpdated={(u) => { onUserUpdated(u); }}
        />
      )}
      {modal === "admin" && (
        <AdminModal onClose={() => setModal(null)} currentUserId={user.id} />
      )}
    </>
  );
}
