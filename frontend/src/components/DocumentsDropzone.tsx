import React, { useRef, useState } from "react";
import { useI18n } from "../i18n";

type DocumentsDropzoneProps = {
  onUpload: (files: FileList | null) => void;
};

const DocumentsDropzone: React.FC<DocumentsDropzoneProps> = ({ onUpload }) => {
  const { t } = useI18n();
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onUpload(files);
  };

  return (
    <div
      className={`documents-dropzone ${dragActive ? "active" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={t("Upload documents")}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="documents-input"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <div className="dropzone-content">
        <span className="dropzone-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="img">
            <path d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4.01 4a1 1 0 0 1-1.4 0l-4.02-4a1 1 0 1 1 1.42-1.42L11 13.59V4a1 1 0 0 1 1-1zm-6 14a1 1 0 0 1 1 1v1h10v-1a1 1 0 1 1 2 0v1a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1z" />
          </svg>
        </span>
        <div className="dropzone-text">
          <span className="dropzone-title">{t("Drag documents or click to browse Finder")}</span>
          <span className="dropzone-subtitle">{t("PDF, DOCX, PNG, etc.")}</span>
        </div>
      </div>
    </div>
  );
};

export default DocumentsDropzone;
