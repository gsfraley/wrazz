import { useEffect } from "react";
import styles from "@/components/modals/Modal.module.css";
import { cx } from "@/lib/utils";

export interface ModalProps {
  title: string;
  onClose: () => void;
  wide?: boolean;
  narrow?: boolean;
  children: React.ReactNode;
}

export default function Modal({ title, onClose, wide, narrow, children }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={cx(styles.modal, wide && styles.modalWide, narrow && styles.modalNarrow)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{title}</span>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
