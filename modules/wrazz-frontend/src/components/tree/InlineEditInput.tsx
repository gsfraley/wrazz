import type { RefObject } from "react";
import styles from "@/components/FileTree.module.css";

interface InlineEditInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export default function InlineEditInput({
  inputRef,
  value,
  onChange,
  onCommit,
  onCancel,
}: InlineEditInputProps) {
  return (
    <input
      ref={inputRef}
      className={styles.treeEditInput}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onCommit(); }
        if (e.key === "Escape") onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
