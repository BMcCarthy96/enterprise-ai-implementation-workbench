"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function RequirementForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/v1/projects/${projectId}/requirements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        details: form.get("details") || undefined,
        priority: form.get("priority"),
      }),
    });
    setBusy(false);
    if (res.ok) {
      formRef.current?.reset();
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to save requirement");
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-3">
      <div>
        <label className="label">Title</label>
        <input
          name="title"
          className="input"
          placeholder="What does the customer need?"
          required
          minLength={3}
        />
      </div>
      <div>
        <label className="label">Details / raw notes</label>
        <textarea
          name="details"
          className="input"
          rows={4}
          placeholder="Paste meeting notes, emails, or context — the scoping engine uses this."
        />
      </div>
      <div>
        <label className="label">Priority</label>
        <select name="priority" className="input" defaultValue="medium">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "Saving..." : "Add requirement"}
      </button>
    </form>
  );
}
