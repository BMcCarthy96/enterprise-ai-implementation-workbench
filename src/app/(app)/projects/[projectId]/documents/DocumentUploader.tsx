"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";

export function DocumentUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const presignRes = await fetch(
        `/api/v1/projects/${projectId}/documents/presign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          }),
        },
      );
      if (!presignRes.ok) {
        const data = await presignRes.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to prepare upload");
      }
      const { uploadUrl, s3Key } = await presignRes.json();

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error("S3 upload failed");

      const registerRes = await fetch(
        `/api/v1/projects/${projectId}/documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            s3Key,
          }),
        },
      );
      if (!registerRes.ok) throw new Error("Failed to register document");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        type="file"
        className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
      {busy && <p className="mt-2 text-xs text-gray-400">Uploading...</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentList({
  documents,
}: {
  documents: Array<{
    id: string;
    fileName: string;
    sizeBytes: number;
    createdAt: string;
  }>;
}) {
  const [error, setError] = useState<string | null>(null);

  async function download(id: string) {
    setError(null);
    const res = await fetch(`/api/v1/documents/${id}/download`);
    if (!res.ok) {
      setError("Could not generate download link");
      return;
    }
    const { url } = await res.json();
    window.open(url, "_blank");
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        title="No documents"
        hint="Upload statements of work, requirement docs, or customer files."
      />
    );
  }

  return (
    <div className="card">
      <ul className="divide-y divide-gray-100">
        {documents.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {d.fileName}
              </p>
              <p className="text-xs text-gray-400">
                {formatBytes(d.sizeBytes)} ·{" "}
                {new Date(d.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
            <button
              className="btn-secondary shrink-0"
              onClick={() => download(d.id)}
            >
              Download
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="px-4 pb-3 text-xs text-red-600">{error}</p>}
    </div>
  );
}
