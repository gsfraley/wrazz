import Modal from "./Modal";

interface Props {
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
}: Props) {
  return (
    <Modal title="Confirm" onClose={onClose} className="modal--narrow">
      <div className="confirm-modal-body">
        <p className="confirm-modal-message">{message}</p>
        <div className="confirm-modal-actions">
          <button className="confirm-btn" onClick={onClose}>Cancel</button>
          <button
            className="confirm-btn confirm-btn--danger"
            onClick={() => { onConfirm(); onClose(); }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
