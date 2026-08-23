"use client";

import type { Role } from "@/lib/auth/rbac";
import type { DemoPersonaOption } from "@/lib/tour";

export function DemoPersonaSwitcher({
  personas,
  role,
  switchingRole,
  onSwitch,
}: {
  personas: DemoPersonaOption[];
  role: Role;
  switchingRole: Role | null;
  onSwitch: (role: Role) => void;
}) {
  const active = personas.find((persona) => persona.role === role) ?? personas[0];
  const busy = Boolean(switchingRole);

  return (
    <div
      className="sticky top-[4.5rem] z-30 border-b border-cyan-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur lg:top-0 lg:ml-60"
      data-testid="demo-role-bar"
    >
      <div className="mx-auto grid min-w-0 gap-2 xl:grid-cols-[13rem_minmax(0,1fr)] xl:items-center xl:gap-4 xl:px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">
              Demo personas
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              Isolated demo
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-4 text-slate-600" data-testid="active-persona-focus">
            {active?.focus}
          </p>
        </div>

        <label className="grid min-w-0 gap-1 xl:hidden">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Viewing as
          </span>
          <select
            value={role}
            disabled={busy}
            aria-label="Switch demo persona"
            aria-busy={busy}
            data-testid="demo-role-select"
            onChange={(event) => onSwitch(event.target.value as Role)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-950 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-300 disabled:cursor-wait disabled:opacity-70"
          >
            {personas.map((persona) => (
              <option key={persona.role} value={persona.role}>
                {switchingRole === persona.role ? "Switching…" : persona.label}
              </option>
            ))}
          </select>
        </label>

        <div
          className="hidden min-w-0 grid-cols-4 gap-2 xl:grid"
          role="group"
          aria-label="Switch demo persona"
        >
          {personas.map((persona) => (
            <button
              key={persona.role}
              type="button"
              onClick={() => onSwitch(persona.role)}
              disabled={busy}
              aria-pressed={persona.role === role}
              aria-busy={switchingRole === persona.role}
              title={persona.focus}
              data-testid={`demo-role-${persona.role}`}
              className={`min-h-11 min-w-0 rounded-lg border px-2.5 py-2 text-center text-xs font-semibold leading-4 transition focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-1 ${
                persona.role === role
                  ? "border-cyan-400 bg-cyan-50 text-cyan-950"
                  : "border-slate-200 bg-white text-slate-600 hover:border-cyan-300 hover:text-slate-950"
              }`}
            >
              {switchingRole === persona.role ? "Switching…" : persona.label}
            </button>
          ))}
        </div>

        <span className="sr-only" aria-live="polite">
          {switchingRole
            ? "Refreshing demo permissions"
            : `Viewing as ${active?.label ?? "demo persona"}`}
        </span>
      </div>
    </div>
  );
}
