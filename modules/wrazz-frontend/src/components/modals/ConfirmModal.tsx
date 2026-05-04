import Modal from "./Modal";
import styles from "./ConfirmModal.module.css";
import { cx } from "../../lib/utils";

export interface ConfirmModalProps {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmModal({
  message,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal title="Confirm" onClose={onClose} narrow>
      <div className={styles.confirmModalBody}>
        <p className={styles.confirmModalMessage}>{message}</p>
        <div className={styles.confirmModalActions}>
          <button className={styles.confirmBtn} onClick={onClose}>Cancel</button>
          <button
            className={cx(styles.confirmBtn, styles.confirmBtnDanger)}
            onClick={() => { onConfirm(); onClose(); }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
