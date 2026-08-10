import Link from "next/link";
import { DemoLaunchButton } from "@/app/DemoLaunchButton";
import {
  getProofManifest,
  proofStatusLabels,
  proofStatusTone,
  type ProofClaim,
  type ProofStatus,
} from "@/lib/proof";

export const metadata = {
  title: "Portfolio proof",
  description:
    "A recruiter-ready evidence map for the Enterprise AI Implementation Workbench.",
};

const statusOrder: ProofStatus[] = ["verified", "implemented", "target", "planned"];

export default function ProofPage() {
  const manifest = getProofManifest();
  const grouped = statusOrder.map((status) => ({
    status,
    claims: manifest.claims.filter((claim) => claim.status === status),
  }));

  return (
    <main className="min-h-screen bg-[#07111f] text-white">
      <div className="hero-grid absolute inset-x-0 top-0 h-[620px] opacity-50" />
      <div className="relative mx-auto max-w-7xl px-6 py-8 lg:px-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300 text-sm font-black text-slate-950">EA</span>
            <span>
              <span className="block text-sm font-semibold tracking-wide">Enterprise AI</span>
              <span className="block text-xs text-slate-400">Implementation Workbench</span>
            </span>
          </Link>
          <nav aria-label="Proof navigation" className="flex items-center gap-4 text-sm text-slate-300">
            <Link href="/" className="transition hover:text-white">Home</Link>
            <a href="https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench" className="transition hover:text-white">GitHub ↗</a>
          </nav>
        </header>

        <section className="grid gap-12 pb-16 pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <p className="eyebrow">Portfolio proof / evidence map</p>
            <h1 className="mt-4 max-w-4xl text-5xl font-semibold leading-[1.03] tracking-[-0.04em] sm:text-6xl">A trustworthy AI workflow is easier to believe when every claim has a trail.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">This is the short path through the Workbench: a grounded plan, an explicit human checkpoint, visible delivery state, and enough operational evidence to discuss the tradeoffs honestly.</p>
            <div className="mt-8 flex flex-wrap items-start gap-4"><DemoLaunchButton checkpoint="ai-evidence" /><Link href="/demo?checkpoint=ai-evidence" className="btn-ghost">Share this checkpoint</Link></div>
            <p className="mt-4 text-xs text-slate-400">Synthetic data only · isolated 60-minute demo · statuses below distinguish verified evidence from targets and planned work.</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 pb-4"><div><p className="text-xs uppercase tracking-[0.18em] text-slate-400">Build evidence</p><p className="mt-1 text-sm font-semibold">{manifest.build.environment} / {manifest.build.commit.slice(0, 12)}</p></div><span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">INSPECTABLE</span></div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <Metric label="Verified" value={String(manifest.claims.filter((claim) => claim.status === "verified").length)} />
              <Metric label="Eval cases" value={String(manifest.evaluation.caseCount)} />
              <Metric label="AI gates" value={formatRate(Math.min(manifest.evaluation.citationValidity ?? 0, manifest.evaluation.injectionResistance ?? 0))} />
            </div>
            <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">The story in one minute</p><ol className="mt-3 space-y-2 text-sm text-slate-300"><li><span className="mr-2 font-mono text-cyan-300">01</span>Requirements become a cited, schema-validated proposal.</li><li><span className="mr-2 font-mono text-cyan-300">02</span>A manager decision is required before task mutation.</li><li><span className="mr-2 font-mono text-cyan-300">03</span>Delivery, customer updates, and failure recovery stay observable.</li></ol></div>
          </div>
        </section>

        <section aria-labelledby="architecture-heading" className="border-y border-white/10 py-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Architecture trail</p><h2 id="architecture-heading" className="mt-2 text-2xl font-semibold">From untrusted input to a governed delivery artifact</h2></div><Link href="https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/architecture.md" className="text-sm text-cyan-200 hover:text-white">Read architecture notes ↗</Link></div>
          <div className="mt-8 grid gap-3 md:grid-cols-5">
            <FlowStep number="01" title="Intake" body="Requirements and documents enter a tenant-scoped boundary." tone="cyan" />
            <FlowStep number="02" title="Ground" body="Redaction and retrieval produce opaque source references." tone="indigo" />
            <FlowStep number="03" title="Validate" body="Zod, citation, injection, and policy checks guard the output." tone="amber" />
            <FlowStep number="04" title="Approve" body="A human decision keeps valid AI output inert until reviewed." tone="emerald" />
            <FlowStep number="05" title="Deliver" body="Jobs, tasks, updates, audit, and recovery remain visible." tone="rose" />
          </div>
        </section>

        <section aria-labelledby="claims-heading" className="py-16">
          <div className="max-w-2xl"><p className="eyebrow">Claim registry</p><h2 id="claims-heading" className="mt-2 text-3xl font-semibold">Evidence is labeled by what it actually proves.</h2><p className="mt-4 leading-7 text-slate-400">The manifest is generated from the same checked-in source that powers this page. A target is not presented as a measurement, and planned enterprise work is visible instead of hidden.</p></div>
          <div className="mt-10 space-y-12">
            {grouped.map(({ status, claims }) => claims.length > 0 && <ClaimGroup key={status} status={status} claims={claims} />)}
          </div>
        </section>

        <section className="grid gap-4 border-t border-white/10 py-12 md:grid-cols-3">
          <Link href="/api/proof/manifest" className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-cyan-300/40"><p className="text-xs uppercase tracking-[0.16em] text-slate-400">Machine-readable</p><h3 className="mt-2 font-semibold">Open proof manifest ↗</h3><p className="mt-2 text-sm leading-6 text-slate-400">Safe build metadata and evidence links for automated review.</p></Link>
          <Link href="/proof/case-study" className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-cyan-300/40"><p className="text-xs uppercase tracking-[0.16em] text-slate-400">Narrative</p><h3 className="mt-2 font-semibold">Open printable case study ↗</h3><p className="mt-2 text-sm leading-6 text-slate-400">Context, tradeoffs, failure modes, and evidence index.</p></Link>
          <Link href="https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/actions" className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-cyan-300/40"><p className="text-xs uppercase tracking-[0.16em] text-slate-400">Reproducibility</p><h3 className="mt-2 font-semibold">Inspect CI artifacts ↗</h3><p className="mt-2 text-sm leading-6 text-slate-400">Quality, evaluation, infrastructure, and browser evidence are generated by automation.</p></Link>
        </section>
        <footer className="border-t border-white/10 py-8 text-xs text-slate-400">Enterprise AI Implementation Workbench · synthetic data · proof status is intentionally honest.</footer>
      </div>
    </main>
  );
}

function ClaimGroup({ status, claims }: { status: ProofStatus; claims: ProofClaim[] }) {
  const headingId = status + "-claims-heading";
  const title = status === "verified" ? "Verified evidence" : status === "implemented" ? "Implemented foundations" : status === "target" ? "Operating targets" : "Planned next";
  return <section aria-labelledby={headingId}><div className="flex items-center gap-3"><h3 id={headingId} className="text-lg font-semibold">{title}</h3><span className={"badge border " + proofStatusTone(status)}>{proofStatusLabels[status]}</span></div><div className="mt-4 grid gap-4 lg:grid-cols-2">{claims.map((claim) => <ClaimCard key={claim.id} claim={claim} />)}</div></section>;
}

function ClaimCard({ claim }: { claim: ProofClaim }) {
  return <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.16em] text-slate-400">{claim.category}</p><h4 className="mt-2 text-base font-semibold text-white">{claim.title}</h4></div><span className={"badge shrink-0 border " + proofStatusTone(claim.status)}>{claim.status}</span></div><p className="mt-3 text-sm leading-6 text-slate-300">{claim.summary}</p><ul className="mt-4 space-y-2 border-t border-white/10 pt-4">{claim.evidence.map((item) => <li key={claim.id + "-" + item.label}><Link href={item.href} className="flex items-center justify-between gap-3 text-sm text-cyan-200 hover:text-white"><span><span className="mr-2 font-mono text-[10px] uppercase text-slate-400">{item.kind}</span>{item.label}</span><span aria-hidden="true">↗</span></Link></li>)}</ul></article>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-white/[0.05] px-3 py-3"><p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{label}</p><p className="mt-1 font-mono text-lg text-cyan-200">{value}</p></div>; }
function formatRate(value: number | null) { return value == null ? "—" : String(Math.round(value * 100)) + "%"; }
function FlowStep({ number, title, body, tone }: { number: string; title: string; body: string; tone: "cyan" | "indigo" | "amber" | "emerald" | "rose" }) { const tones = { cyan: "border-cyan-300/20 bg-cyan-300/5", indigo: "border-indigo-300/20 bg-indigo-300/5", amber: "border-amber-300/20 bg-amber-300/5", emerald: "border-emerald-300/20 bg-emerald-300/5", rose: "border-rose-300/20 bg-rose-300/5" }; return <div className={"rounded-2xl border p-4 " + tones[tone]}><span className="font-mono text-[10px] text-slate-400">{number}</span><h3 className="mt-3 text-sm font-semibold">{title}</h3><p className="mt-2 text-xs leading-5 text-slate-300">{body}</p></div>; }
