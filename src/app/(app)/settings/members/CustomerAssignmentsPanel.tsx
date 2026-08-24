"use client";

import { useState } from "react";

type Option = { id: string; label: string; detail?: string };
type Assignment = { id: string; userId: string; userName: string; userEmail: string; customerId: string; customerName: string };

export function CustomerAssignmentsPanel({
  members,
  customers,
  initialAssignments,
}: {
  members: Option[];
  customers: Option[];
  initialAssignments: Assignment[];
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [userId, setUserId] = useState(members[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function addAssignment(event: React.FormEvent) {
    event.preventDefault();
    if (!userId || !customerId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/customer-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, customerId }),
      });
      const body = (await response.json().catch(() => ({}))) as { assignment?: Assignment | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to save assignment");
      if (body.assignment) setAssignments((current) => [...current, body.assignment!]);
      setMessage(body.assignment ? "Customer access saved." : "That access assignment already exists.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save assignment");
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(id: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/customer-assignments?assignmentId=${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to remove assignment");
      setAssignments((current) => current.filter((assignment) => assignment.id !== id));
      setConfirmingId(null);
      setMessage("Customer access removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove assignment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5" aria-labelledby="customer-access-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="customer-access-heading" className="text-sm font-semibold text-gray-900">Customer access</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">Customer stakeholders only see projects for the customers assigned here. Internal roles keep full portfolio access.</p>
        </div>
        <span className="badge">{assignments.length} {assignments.length === 1 ? "assignment" : "assignments"}</span>
      </div>
      {members.length > 0 && customers.length > 0 ? (
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={addAssignment}>
          <label className="label w-full sm:w-auto sm:min-w-56">Customer stakeholder<select className="input mt-1" value={userId} onChange={(event) => setUserId(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.label}{member.detail ? ` · ${member.detail}` : ""}</option>)}</select></label>
          <label className="label w-full sm:w-auto sm:min-w-56">Customer<select className="input mt-1" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}</select></label>
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy}>{busy ? "Saving…" : "Assign customer"}</button>
        </form>
      ) : <p className="mt-4 text-sm text-gray-500">Create a customer and an active customer stakeholder before adding an assignment.</p>}
      {message ? <p className="mt-3 text-sm text-slate-600" role="status">{message}</p> : null}
      <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100" data-testid="customer-assignment-list">
        {assignments.map((assignment) => <li key={assignment.id} data-testid="customer-assignment" className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0"><strong className="block font-medium text-gray-900">{assignment.userName}</strong><span className="block break-words text-xs text-gray-500">{assignment.userEmail} · {assignment.customerName}</span></span>{confirmingId === assignment.id ? <span className="flex items-center gap-2"><button type="button" className="text-xs font-semibold text-slate-600 hover:underline" disabled={busy} onClick={() => setConfirmingId(null)}>Cancel</button><button type="button" className="text-xs font-semibold text-rose-700 hover:underline" disabled={busy} onClick={() => void removeAssignment(assignment.id)}>{busy ? "Removing…" : "Confirm remove"}</button></span> : <button type="button" className="text-xs font-semibold text-rose-700 hover:underline" disabled={busy} onClick={() => setConfirmingId(assignment.id)}>Remove</button>}</li>)}
        {assignments.length === 0 ? <li className="py-4 text-sm text-gray-500">No customer access assignments yet.</li> : null}
      </ul>
    </section>
  );
}
