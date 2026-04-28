import { useState } from "react";
import Modal from "./Modal";

type AdminPage = "info" | "sso";

interface Props {
  onClose: () => void;
}

export default function AdminModal({ onClose }: Props) {
  const [page, setPage] = useState<AdminPage>("info");

  return (
    <Modal title="Administration" onClose={onClose} wide>
      <div className="admin-modal-inner">
        <nav className="admin-nav">
          <button
            className={`admin-nav-item${page === "info" ? " active" : ""}`}
            onClick={() => setPage("info")}
          >
            Info
          </button>
          <button
            className={`admin-nav-item${page === "sso" ? " active" : ""}`}
            onClick={() => setPage("sso")}
          >
            SSO
          </button>
        </nav>
        <div className="admin-section">
          {page === "info" && <InfoPage />}
          {page === "sso" && <SsoPage />}
        </div>
      </div>
    </Modal>
  );
}

function InfoPage() {
  return (
    <div className="admin-info">
      <p className="admin-info-name">wrazz</p>
      <p className="admin-info-version">version 0.1.1</p>
      <p className="admin-info-desc">
        Self-hosted personal journal built around plain Markdown files.
      </p>
      <div className="admin-info-links">
        <a
          className="admin-info-link"
          href="https://github.com/gsfraley/wrazz"
          target="_blank"
          rel="noreferrer"
        >
          github.com/gsfraley/wrazz
        </a>
      </div>
    </div>
  );
}

function SsoPage() {
  return (
    <div className="admin-sso-placeholder">
      <p className="admin-sso-placeholder-title">Single Sign-On</p>
      <p className="admin-sso-placeholder-body">
        OIDC configuration will be available here. For now, configure SSO via
        the <code>WRAZZ_OIDC_*</code> environment variables.
      </p>
    </div>
  );
}
