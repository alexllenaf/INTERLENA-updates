import React, { useState } from "react";
import { downloadBackup, getStorageInfo } from "../api";

const SettingsPage: React.FC = () => {
  const [storageInfo, setStorageInfo] = useState<null | {
    data_dir: string;
    db_path: string;
    uploads_dir: string;
    backups_dir: string;
    state_path: string;
    update_feed?: string;
  }>(null);

  React.useEffect(() => {
    getStorageInfo()
      .then((info) => setStorageInfo(info))
      .catch(() => setStorageInfo(null));
  }, []);

  return (
    <div className="settings">
      <section className="panel">
        <h3>Storage & Backups</h3>
        <p>Data is stored in the system app data directory, not inside the app bundle.</p>
        {storageInfo ? (
          <div className="storage-grid">
            <div className="storage-row">
              <span>Data folder</span>
              <code>{storageInfo.data_dir}</code>
            </div>
            <div className="storage-row">
              <span>Database</span>
              <code>{storageInfo.db_path}</code>
            </div>
            <div className="storage-row">
              <span>Uploads</span>
              <code>{storageInfo.uploads_dir}</code>
            </div>
            <div className="storage-row">
              <span>Backups</span>
              <code>{storageInfo.backups_dir}</code>
            </div>
            <div className="storage-row">
              <span>State</span>
              <code>{storageInfo.state_path}</code>
            </div>
          </div>
        ) : (
          <div className="empty">Storage info unavailable.</div>
        )}
        <div className="form-actions">
          <button className="ghost" type="button" onClick={downloadBackup}>
            Download backup (.zip)
          </button>
        </div>
      </section>
    </div>
  );
};

export default SettingsPage;
