import { useRef, useState, useEffect, useMemo } from "react";
import { listAllFiles } from "@/api/files";
import type { FileSummary } from "@/api/files";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { hooksForPalette } from "@/lib/pluginRegistry";
import { buildContext } from "@/lib/buildContext";
import { triggerDownload } from "@/lib/triggerDownload";
import { pathToDisplayTitle, cx } from "@/lib/utils";
import { useWindowDrag } from "@/lib/windowDrag";
import type { Hook } from "@/lib/plugin";
import type { ContextMenuItem } from "@/components/ContextMenu";
import { Save, RotateCcw, Download, Search } from "@/icons";
import { isDesktop } from "@/lib/api";
import WindowControls from "@/components/WindowControls";
import ProfileModal from "@/components/modals/ProfileModal";
import AdminModal from "@/components/modals/AdminModal";
import CommandPalette from "@/components/CommandPalette";
import type { PaletteItem, Section, DropdownPos } from "@/components/CommandPalette";
import styles from "@/components/CommandBar.module.css";

type CommandHook = Extract<Hook, { type: "command" }>;

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

export default function CommandBar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [allFiles, setAllFiles] = useState<FileSummary[]>([]);
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);
  const onDragDown = useWindowDrag();

  const { user, activeModal, openModal, closeModal, openCtxMenu, paletteOpen: open, setPaletteOpen, desktopPrefs } = useUIStore();
  const showRightControls = isDesktop() && desktopPrefs?.buttonSide === "right";
  const { activePath, isDirty, draft, activeFile } = useDocumentStore();
  const hasActiveFile = activeFile !== null;
  const editorTitle = draft?.title || (activePath ? pathToDisplayTitle(activePath) : null);

  // Side effects when the palette opens (whether triggered locally or via keyboard hook).
  useEffect(() => {
    if (!open) return;
    if (inputWrapRef.current) {
      const wrapRect = inputWrapRef.current.getBoundingClientRect();
      setDropdownPos({ top: wrapRect.bottom, left: wrapRect.left, width: wrapRect.width });
    }
    const wsId = useWorkspaceStore.getState().activeWorkspaceId;
    if (wsId) listAllFiles(wsId, "/").then(setAllFiles).catch(() => {});
    setQuery("");
    setSelected(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  function openPalette() { setPaletteOpen(true); }

  function closePalette() {
    setPaletteOpen(false);
    setQuery("");
    setSelected(0);
    inputRef.current?.blur();
  }

  const sections = useMemo((): Section[] => {
    if (!open) return [];
    const ctx = buildContext();
    if (!ctx) return [];
    const commands = hooksForPalette(ctx);

    if (!query) {
      const visible = commands.filter((h) => h.defaultVisible !== false);
      if (visible.length === 0) return [];
      const byGroup = new Map<string, CommandHook[]>();
      for (const h of visible) {
        const g = h.group ?? "";
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(h);
      }
      return [...byGroup.entries()].map(([label, hooks]) => ({
        label: label || null,
        items: hooks.map((h) => ({ kind: "command" as const, hook: h })),
      }));
    }

    const matchHook = (h: CommandHook) =>
      fuzzyMatch(h.label, query) || h.keywords?.some((k) => fuzzyMatch(k, query)) === true;
    const matched = commands.filter(matchHook);
    const matchedFiles = allFiles
      .filter((f) => {
        const displayTitle = f.title ?? pathToDisplayTitle(f.path);
        return fuzzyMatch(f.path, query) || fuzzyMatch(displayTitle, query);
      })
      .slice(0, 8);

    const result: Section[] = [];
    if (matched.length > 0) {
      result.push({ label: "Actions", items: matched.map((h) => ({ kind: "command" as const, hook: h })) });
    }
    if (matchedFiles.length > 0) {
      result.push({ label: "Files", items: matchedFiles.map((f) => ({ kind: "file" as const, path: f.path, displayLabel: f.title ?? pathToDisplayTitle(f.path) })) });
    }
    return result;
  }, [open, query, allFiles]);

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
    if (item.kind === "command") {
      const ctx = buildContext();
      if (ctx) void item.hook.run(ctx);
    } else {
      void useDocumentStore.getState().openFile(item.path);
    }
    closePalette();
  }

  function userMenuItems(): ContextMenuItem[] {
    return [
      { type: "item", label: "Edit profile", onClick: () => openModal("profile") },
      ...(user?.is_admin ? [{ type: "item" as const, label: "Administration", onClick: () => openModal("admin") }] : []),
      { type: "separator" },
      { type: "item", label: "Sign out", onClick: () => { void useUIStore.getState().performLogout(); } },
    ];
  }

  type Chip = { id: string; label: string; icon: React.ComponentType<{ size?: number }>; run: () => void };
  const contextChips: Chip[] = !hasActiveFile ? [] : [
    { id: "save", label: "Save", icon: Save, run: () => { void useDocumentStore.getState().saveFile(); } },
    ...(isDirty ? [{ id: "discard", label: "Discard", icon: RotateCcw, run: () => { void useDocumentStore.getState().discardChanges(); } }] : []),
    { id: "export", label: "Export", icon: Download, run: () => {
      const wsId = useWorkspaceStore.getState().activeWorkspaceId;
      if (activePath && wsId) triggerDownload(`/api/v1/workspaces/${wsId}/export/file/${activePath.replace(/^\/|\/$/g, "")}`);
    } },
  ];

  return (
    <>
      <div className={cx(styles.commandBar, open && styles.isOpen, showRightControls && styles.rightControlsActive)} onMouseDown={onDragDown}>
        <div className={cx(styles.commandInputWrap, open && styles.isOpen)} ref={inputWrapRef}>
          <Search size={14} className={styles.commandInputSearchIcon} />
          <input
            ref={inputRef}
            className={cx(styles.commandInput, open && styles.isOpen)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={() => { if (!open) openPalette(); }}
            onKeyDown={handleInputKeyDown}
            placeholder={open ? "Search or run a command…" : (editorTitle || "Search or run a command…")}
            tabIndex={-1}
            autoComplete="off"
            spellCheck={false}
          />
          {!open && contextChips.length > 0 && (
            <div className={styles.commandChips}>
              {contextChips.map((chip) => (
                <button
                  key={chip.id}
                  className={styles.commandChip}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); chip.run(); }}
                  title={chip.label}
                >
                  <chip.icon size={12} />
                  <span>{chip.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {!isDesktop() && (
          <div className={styles.userMenu}>
            <button
              className={styles.userMenuTrigger}
              onClick={(e) => openCtxMenu(e, userMenuItems(), "top-to-element-bottom", "right-to-element-right")}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {user?.display_name}
            </button>
          </div>
        )}
        {showRightControls && <WindowControls side="right" />}
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

      {activeModal === "profile" && <ProfileModal onClose={closeModal} />}
      {activeModal === "admin" && <AdminModal onClose={closeModal} />}
    </>
  );
}
