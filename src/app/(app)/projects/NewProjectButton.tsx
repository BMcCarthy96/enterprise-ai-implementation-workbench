"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewProjectButton({
  customers,
}: {
  customers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCustomer, setNewCustomer] = useState(customers.length === 0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);

    let customerId = form.get("customerId") as string;
    if (newCustomer) {
      const res = await fetch("/api/v1/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("customerName"),
          industry: form.get("customerIndustry") || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to create customer");
        setBusy(false);
        return;
      }
      customerId = (await res.json()).customer.id;
    }

    const res = await fetch("/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        name: form.get("name"),
        description: form.get("description") || undefined,
        targetDate: form.get("targetDate") || undefined,
      }),
    });
    if (res.ok) {
      const { project } = await res.json();
      setOpen(false);
      router.push(`/projects/${project.id}`);
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to create project");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        New project
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          New project
        </h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Customer</label>
            {!newCustomer ? (
              <div className="flex items-center gap-2">
                <select name="customerId" className="input" required>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="whitespace-nowrap text-xs text-indigo-600 hover:text-indigo-800"
                  onClick={() => setNewCustomer(true)}
                >
                  + New
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  name="customerName"
                  className="input"
                  placeholder="Customer name"
                  required
                />
                <input
                  name="customerIndustry"
                  className="input"
                  placeholder="Industry (optional)"
                />
                {customers.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                    onClick={() => setNewCustomer(false)}
                  >
                    Choose existing customer instead
                  </button>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="label">Project name</label>
            <input name="name" className="input" required minLength={2} />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea name="description" className="input" rows={3} />
          </div>
          <div>
            <label className="label">Target date</label>
            <input name="targetDate" type="date" className="input" />
          </div>
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Creating..." : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
