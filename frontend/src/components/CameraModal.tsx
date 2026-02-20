import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

export interface CameraModalProps {
  onCapture: (dataUrl: string) => void;
  onUpload: () => void;
  onClose: () => void;
}

const CameraModal: React.FC<CameraModalProps> = ({ onCapture, onUpload, onClose }) => {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t("Your browser cannot open the camera. Use Upload photo."));
        onUpload();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        if (!cancelled) {
          setError(t("Could not access the camera. Use Upload photo."));
          onClose();
          onUpload();
        }
      }
    };
    startCamera();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [onClose, onUpload, stopStream, t]);

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const width = videoRef.current.videoWidth;
    const height = videoRef.current.videoHeight;
    if (!width || !height) {
      setError(t("Camera is not ready yet."));
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    stopStream();
    onCapture(dataUrl);
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("Take photo")}
      onClick={onClose}
    >
      <div className="modal camera-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{t("Take photo")}</h3>
            <p>{t("Use the camera to update your profile photo.")}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Close")}>
            X
          </button>
        </div>
        <div className="camera-body">
          {error ? (
            <div className="alert">{error}</div>
          ) : (
            <video ref={videoRef} className="camera-video" playsInline muted autoPlay />
          )}
        </div>
        <div className="camera-actions">
          <button className="ghost" type="button" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              onClose();
              onUpload();
            }}
          >
            {t("Upload photo")}
          </button>
          <button className="primary" type="button" onClick={capturePhoto} disabled={!!error}>
            {t("Capture")}
          </button>
        </div>
        <canvas ref={canvasRef} className="camera-canvas" />
      </div>
    </div>
  );
};

export default CameraModal;
