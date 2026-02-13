import React, { useState } from "react";
import BlockPanel from "../components/BlockPanel";
import { downloadBackup, getStorageInfo } from "../api";
import { Locale, useI18n } from "../i18n";

const SettingsPage: React.FC = () => {
  const { locale, setLocale, t } = useI18n();
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
      <BlockPanel id="settings:language" as="section">
        <h3>{t("Language")}</h3>
        <p>{t("Change the app language.")}</p>
        <div className="field">
          <label htmlFor="settings-language">{t("App language")}</label>
          <select
            id="settings-language"
            value={locale}
            onChange={(event) => {
              const next = event.target.value === "es" ? "es" : "en";
              setLocale(next as Locale);
            }}
          >
            <option value="es">{t("Spanish")}</option>
            <option value="en">{t("English")}</option>
          </select>
        </div>
      </BlockPanel>
      <BlockPanel id="settings:storage" as="section">
        <h3>{t("Storage & Backups")}</h3>
        <p>{t("Data is stored in the system app data directory, not inside the app bundle.")}</p>
        {storageInfo ? (
          <div className="storage-grid">
            <div className="storage-row">
              <span>{t("Data folder")}</span>
              <code>{storageInfo.data_dir}</code>
            </div>
            <div className="storage-row">
              <span>{t("Database")}</span>
              <code>{storageInfo.db_path}</code>
            </div>
            <div className="storage-row">
              <span>{t("Uploads")}</span>
              <code>{storageInfo.uploads_dir}</code>
            </div>
            <div className="storage-row">
              <span>{t("Backups")}</span>
              <code>{storageInfo.backups_dir}</code>
            </div>
            <div className="storage-row">
              <span>{t("State")}</span>
              <code>{storageInfo.state_path}</code>
            </div>
          </div>
        ) : (
          <div className="empty">{t("Storage info unavailable.")}</div>
        )}
        <div className="form-actions">
          <button className="ghost" type="button" onClick={downloadBackup}>
            {t("Download backup (.zip)")}
          </button>
        </div>
      </BlockPanel>
    </div>
  );
};

export default SettingsPage;
