import { JSX, useEffect, useRef } from "react";
import { IconProps } from "../icons";

export type ContextMenuItem = 
  | { type: "item", label: string, danger?: boolean, icon?: (props: IconProps) => JSX.Element, onClick: () => void }
  | { type: "separator" }

export interface ContextMenuProps {
  vertical: { top: number } | { bottom: number }
  horizontal: { left: number } | { right: number }
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ vertical, horizontal, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Keep the menu inside the viewport.
  const style: React.CSSProperties = {
    position: "fixed",
    top: "top" in vertical ? vertical.top : undefined,
    bottom: "bottom" in vertical ? vertical.bottom : undefined,
    left: "left" in horizontal ? horizontal.left : undefined,
    right: "right" in horizontal ? horizontal.right : undefined,
    zIndex: 300,
  };

  return (
    <div ref={ref} className="ctx-menu" style={style}>
      {items.map((item, i) => {
        switch (item.type) {
          case "item": return (
            <button
              key={i}
              className={`ctx-menu-item${item.danger ? " ctx-menu-item--danger" : ""}`}
              onClick={() => { item.onClick(); onClose(); }}
            >
              {item.label}
              {item.icon && item.icon({size: 13})}
            </button>
            )
          case "separator": return (
            <hr className="ctx-menu-divider" />
            )
      }})}
    </div>
  );
}
