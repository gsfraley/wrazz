import { useRef, useState, useEffect, useMemo } from "react";
import type { CurrentUser } from "@/api/auth";
import { listAllFilePaths } from "@/api/files";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { getActions } from "@/lib/actions";
import { pathToDisplayTitle, cx } from "@/lib/utils";
import type { ContextMenuItem } from "@/components/ContextMenu";
import { Search } from "@/icons";
import ProfileModal from "@/components/modals/ProfileModal";
import AdminModal from "@/components/modals/AdminModal";
import CommandPalette from "@/components/CommandPalette";
import type { PaletteItem, Section, DropdownPos } from "@/components/CommandPalette";
import styles from "@/components/CommandBar.module.css";

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

type Modal = "profile" | "admin" | null;

export interface CommandBarProps {
  user: CurrentUser;
  onLogout: () => void;
  onUserUpdated: (user: CurrentUser) => void;
}

export default function CommandBar({ user, onLogout, onUserUpdated }: CommandBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const commandBarRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);

  const { activeCtx, openCtxMenu } = useUIStore();
  const { activePath, isDirty, draft, activeFile } = useDocumentStore();
  const hasActiveFile = activeFile !== null;
  const editorTitle = draft?.title || (activePath ? pathToDisplayTitle(activePath) : null);

  useEffect(() => {
    listAllFilePaths("/").then(setAllFiles).catch(() => {});
  }, []);

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
      const editorActions = hasActiveFile ? actions.filter((a) => a.contexts?.includes("editor")) : [];
      const otherActions = actions.filter((a) => !a.contexts?.includes("editor"));
      const result: Section[] = [];
      if (editorActions.length > 0) result.push({ label: null, items: editorActions.map((a) => ({ kind: "action" as const, action: a })) });
      if (otherActions.length > 0) result.push({ label: null, items: otherActions.map((a) => ({ kind: "action" as const, action: a })) });
      return result;
    }

    const matchAction = (a: ReturnType<typeof getActions>[number]) =>
      fuzzyMatch(a.label, query) || a.keywords?.some((k) => fuzzyMatch(k, query));
    const matched = [...actions].filter(matchAction);
    const ctxActions = matched.filter((a) => activeCtx && a.contexts?.includes(activeCtx));
    const otherActions = matched.filter((a) => !activeCtx || !a.contexts?.includes(activeCtx));
    const matchedFiles = allFiles
      .filter((p) => fuzzyMatch(p, query) || fuzzyMatch(pathToDisplayTitle(p), query))
      .slice(0, 8);

    const result: Section[] = [];
    if (ctxActions.length + otherActions.length > 0) {
      result.push({ label: "Actions", items: [...ctxActions, ...otherActions].map((a) => ({ kind: "action" as const, action: a })) });
    }
    if (matchedFiles.length > 0) {
      result.push({ label: "Files", items: matchedFiles.map((p) => ({ kind: "file" as const, path: p, displayLabel: pathToDisplayTitle(p) })) });
    }
    return result;
  }, [open, query, activeCtx, allFiles, hasActiveFile]);

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  useEffect(() => { setSelected(0); }, [flatItems]);

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); closePalette(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, flatItems.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[selected];
      if (!item) return;
      runItem(item);
    }
  }

  function runItem(item: PaletteItem) {
    if (item.kind === "action") { item.action.handler(); closePalette(); }
    else { void useDocumentStore.getState().openFile(item.path); closePalette(); }
  }

  function userMenuItems(): ContextMenuItem[] {
    return [
      { type: "item", label: "Profile", onClick: () => setModal("profile") },
      ...(user.is_admin ? [{ type: "item" as const, label: "Administration", onClick: () => setModal("admin") }] : []),
      { type: "separator" },
      { type: "item", label: "Sign out", onClick: onLogout },
    ];
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
                <button key={a.id} className={styles.commandChip} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); a.handler(); }} title={a.label}>
                  {a.icon && <a.icon size={12} />}
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={styles.userMenu}>
          <button
            className={styles.userMenuTrigger}
            onClick={(e) => openCtxMenu(e, userMenuItems(), "top-to-element-bottom", "right-to-element-right")}
          >
            {user.display_name}
          </button>
        </div>
      </div>

      {open && dropdownPos && (
        <CommandPalette
          dropdownPos={dropdownPos}
          sections={sections}
          flatItems={flatItems}
          selected={selected}
          onClose={closePalette}
          onRunItem={runItem}
          onSetSelected={setSelected}
        />
      )}

      {modal === "profile" && <ProfileModal user={user} onClose={() => setModal(null)} onUpdated={onUserUpdated} />}
      {modal === "admin" && <AdminModal onClose={() => setModal(null)} currentUserId={user.id} />}
    </>
  );
}
