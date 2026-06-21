import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cx } from "@/lib/utils";
import styles from "@/components/WindowControls.module.css";

interface Props {
  side: "left" | "right";
}

export default function WindowControls({ side }: Props) {
  // stopPropagation prevents these clicks from bubbling to the drag region.
  const stopDrag = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);
  const close    = useCallback(() => void getCurrentWindow().close(), []);
  const minimize = useCallback(() => void getCurrentWindow().minimize(), []);
  const maximize = useCallback(() => void getCurrentWindow().toggleMaximize(), []);

  if (side === "left") {
    return (
      <div className={cx(styles.controls, styles.left)} onMouseDown={stopDrag}>
        <button className={cx(styles.dot, styles.dotClose)}    onClick={close}    aria-label="Close" />
        <button className={cx(styles.dot, styles.dotMinimize)} onClick={minimize} aria-label="Minimize" />
        <button className={cx(styles.dot, styles.dotMaximize)} onClick={maximize} aria-label="Maximize" />
      </div>
    );
  }

  return (
    <div className={cx(styles.controls, styles.right)} onMouseDown={stopDrag}>
      <button className={cx(styles.btn, styles.btnMinimize)} onClick={minimize} aria-label="Minimize">
        <span className={styles.btnIcon}>&#x2212;</span>
      </button>
      <button className={cx(styles.btn, styles.btnMaximize)} onClick={maximize} aria-label="Maximize">
        <span className={styles.btnIcon}>&#x25A1;</span>
      </button>
      <button className={cx(styles.btn, styles.btnClose)} onClick={close} aria-label="Close">
        <span className={styles.btnIcon}>&#x00D7;</span>
      </button>
    </div>
  );
}
