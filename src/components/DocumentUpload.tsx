"use client";

import { useState, useRef } from "react";
import { Upload, CheckCircle, AlertTriangle, FileImage, X, Loader2, Eye } from "lucide-react";

type DocItem = {
  type: string;
  label: string;
  desc: string;
  required?: boolean;
};

type UploadedFile = {
  file: File;
  preview?: string;
  uploading: boolean;
  done: boolean;
  error?: string;
};

type Props = {
  docs: DocItem[];
  userId: string;
  role: "business" | "rider";
  onComplete?: () => void;
};

export function DocumentUpload({ docs, userId, role, onComplete }: Props) {
  const [files, setFiles] = useState<Record<string, UploadedFile>>({});
  const [allDone, setAllDone] = useState(false);

  const handleUpload = async (docType: string, file: File) => {
    setFiles((prev) => ({
      ...prev,
      [docType]: { file, uploading: true, done: false },
    }));

    try {
      const { uploadVerificationDoc } = await import("@/lib/db");
      const result = await uploadVerificationDoc(userId, role, docType, file);
      if (result) {
        setFiles((prev) => ({
          ...prev,
          [docType]: { ...prev[docType], uploading: false, done: true },
        }));
      } else {
        setFiles((prev) => ({
          ...prev,
          [docType]: { ...prev[docType], uploading: false, error: "Upload failed. Try again." },
        }));
      }
    } catch {
      setFiles((prev) => ({
        ...prev,
        [docType]: { ...prev[docType], uploading: false, error: "Upload failed. Try again." },
      }));
    }

    // Check if all done
    const updated = { ...files, [docType]: { uploading: false, done: true } };
    const requiredDocs = docs.filter((d) => d.required !== false);
    const allUploaded = requiredDocs.every((d) => updated[d.type]?.done);
    if (allUploaded) {
      setAllDone(true);
      onComplete?.();
    }
  };

  const previewFile = (file: File) => {
    const url = URL.createObjectURL(file);
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted">
        Upload required documents for verification. Your account will be reviewed by our team.
      </p>

      {docs.map((doc) => {
        const uploaded = files[doc.type];
        return (
          <div key={doc.type} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                uploaded?.done ? "bg-success/10" : uploaded?.error ? "bg-danger/10" : "bg-elevated"
              }`}>
                {uploaded?.done ? (
                  <CheckCircle className="h-5 w-5 text-success" />
                ) : uploaded?.uploading ? (
                  <Loader2 className="h-5 w-5 text-go animate-spin" />
                ) : (
                  <FileImage className="h-5 w-5 text-dim" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{doc.label}</p>
                <p className="text-[11px] text-muted">{doc.desc}</p>
                {doc.required !== false && (
                  <span className="mt-0.5 inline-block text-[9px] font-medium text-danger">Required</span>
                )}
                {uploaded?.done && (
                  <p className="mt-1 text-[10px] text-success flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Uploaded: {uploaded.file.name}
                  </p>
                )}
                {uploaded?.error && (
                  <p className="mt-1 text-[10px] text-danger flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {uploaded.error}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              {!uploaded?.done && !uploaded?.uploading && (
                <label className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-bg px-3 py-2.5 text-xs font-medium text-muted cursor-pointer hover:border-go/40 hover:text-go transition">
                  <Upload className="h-3.5 w-3.5" />
                  Choose file
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const preview = URL.createObjectURL(file);
                        setFiles((prev) => ({
                          ...prev,
                          [doc.type]: { file, preview, uploading: false, done: false },
                        }));
                        handleUpload(doc.type, file);
                      }
                    }}
                  />
                </label>
              )}
              {uploaded?.done && uploaded?.file && (
                <button type="button" onClick={() => previewFile(uploaded.file)}
                  className="flex items-center gap-1 rounded-xl bg-elevated px-3 py-2 text-[10px] font-medium text-muted hover:bg-panel transition">
                  <Eye className="h-3 w-3" /> Preview
                </button>
              )}
              {uploaded?.error && (
                <button type="button" onClick={() => {
                  const f = uploaded.file;
                  setFiles((prev) => ({ ...prev, [doc.type]: { file: f, uploading: false, done: false, error: undefined } }));
                  handleUpload(doc.type, f);
                }}
                  className="flex items-center gap-1 rounded-xl bg-go/10 px-3 py-2 text-[10px] font-medium text-go hover:bg-go/20 transition">
                  <Upload className="h-3 w-3" /> Retry
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
