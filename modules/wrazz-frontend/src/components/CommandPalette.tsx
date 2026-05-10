import { cx } from "@/lib/utils";
import type { Action } from "@/lib/actions";
import styles from "@/components/CommandBar.module.css";

export type PaletteItem =
  | { kind: "action"; action: Action }
  | { kind: "file"; path: string; displayLabel: string };

export interface Section {
  label: string | null;
  items: PaletteItem[];
}

export interface DropdownPos {
  top: number;
  left: number;
  width: number;
}

interface CommandPaletteProps {
  dropdownPos: DropdownPos;
  sections: Section[];
  flatItems: PaletteItem[];
  selected: number;
  onClose: () => void;
  onRunItem: (item: PaletteItem) => void;
  onSetSelected: (i: number) => void;
}

export default function CommandPalette({
  dropdownPos,
  sections,
  flatItems,
  selected,
  onClose,
  onRunItem,
  onSetSelected,
}: CommandPaletteProps) {
  const itemIndex = new Map<PaletteItem, number>();
  flatItems.forEach((item, i) => itemIndex.set(item, i));

  return (
    <>
      <div className={styles.commandBackdrop} onMouseDown={onClose} />
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
                      onClick={() => onRunItem(item)}
                      onMouseEnter={() => onSetSelected(idx)}
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
                    onClick={() => onRunItem(item)}
                    onMouseEnter={() => onSetSelected(idx)}
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
    </>
  );
}
