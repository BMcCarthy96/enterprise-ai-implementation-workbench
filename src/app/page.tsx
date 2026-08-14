import Link from "next/link";
import { DemoLaunchButton } from "./DemoLaunchButton";
import scoreboard from "../../evals/scoreboard.json";

const flagshipScore = scoreboard.variants["plan-v2.0"] ?? scoreboard.variants["plan-v1.0"];
const scorePercent = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value * 100)}%`;

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#07111f] text-white">
      <div className="hero-grid absolute inset-0 opacity-60" />
      <div className="relative mx-auto max-w-7xl px-6 py-8 lg:px-10 lg:py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300 text-sm font-black text-slate-950">EA</span>
            <span><span className="block text-sm font-semibold tracking-wide">Enterprise AI</span><span className="block text-xs text-slate-400">Implementation Workbench</span></span>
          </Link>
          <nav aria-label="Public" className="flex items-center gap-3 text-xs text-slate-300 sm:gap-5 sm:text-sm">
            <Link href="/proof" className="transition hover:text-white">Proof</Link>
            <Link href="/login" className="transition hover:text-white">Sign in</Link>
            <a href="https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench" className="hidden transition hover:text-white sm:inline">GitHub ↗</a>
          </nav>
        </header>

        <section className="grid items-center gap-12 pb-20 pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:pb-28 lg:pt-28">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /> Recruiter-ready AI systems portfolio</p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.04em] text-white sm:text-6xl">AI that drafts delivery work. Humans who stay in control.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">The Workbench turns messy implementation requirements into grounded, schema-validated plans with retrieval citations, repair traces, cost telemetry, and an explicit approval gate before anything reaches execution.</p>
            <div className="mt-8 flex flex-wrap items-start gap-4"><DemoLaunchButton /><Link href="/demo?checkpoint=portfolio-health" className="btn-ghost">Explore self-guided demo</Link></div>
            <p className="mt-4 text-xs text-slate-400"><Link href="/demo?checkpoint=ai-evidence" className="text-cyan-200 hover:text-white">Take the 5-minute technical tour ↗</Link> <span className="mx-2 text-slate-600">·</span> <Link href="/login" className="text-slate-300 hover:text-white">Sign in to an existing workspace</Link></p>
            <p className="mt-4 text-xs text-slate-400">The demo uses synthetic data, creates an isolated 60-minute workspace, and never shares credentials between visitors.</p>
          </div>
          <div className="relative">
            <div className="glow-orb absolute -right-16 -top-20 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="relative rounded-3xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-cyan-950/30 backdrop-blur">
              <div className="rounded-2xl border border-white/10 bg-[#0b1728] p-5">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4"><div><p className="text-xs uppercase tracking-[0.18em] text-slate-400">AI quality / recorded trace</p><p className="mt-1 text-sm font-semibold">Order intake implementation</p></div><span className="shrink-0 rounded-full bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">APPROVAL READY</span></div>
                <div className="mt-5 space-y-3">
                  <TraceRow number="01" label="Retrieve project brief" detail="8 scoped chunks · HNSW" tone="cyan" />
                  <TraceRow number="02" label="Generate structured plan" detail="Claude · plan-v1.1 · 1,200 in / 900 out" tone="indigo" />
                  <TraceRow number="03" label="Validate + repair" detail="Schema failed → repaired in one call" tone="amber" />
                  <TraceRow number="04" label="Human approval gate" detail="No task mutation before manager decision" tone="emerald" />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2"><MiniMetric label="COST" value="$0.015" /><MiniMetric label="LATENCY" value="2.35s" /><MiniMetric label="CITATIONS" value="S1–S4" /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 border-y border-white/10 py-8 sm:grid-cols-3"><Evidence value={scorePercent(flagshipScore?.schemaValidRate)} label={`offline schema validity · ${scoreboard.caseCount} cases`} /><Evidence value={scorePercent(Math.min(flagshipScore?.citationValidity ?? 0, flagshipScore?.injectionResistance ?? 0))} label="citation + injection gates" /><Evidence value="0" label="autonomous delivery mutations" /></section>

        <section className="grid gap-12 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:py-28"><div><p className="eyebrow">The engineering thesis</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">AI output is a proposal, not a side effect.</h2><p className="mt-4 max-w-md leading-7 text-slate-400">Every model call is observable, every artifact is validated, and every plan must pass a human checkpoint before it becomes milestones and tasks. The architecture is deliberately honest about failures.</p></div><div className="grid gap-3 sm:grid-cols-2"><Feature title="Grounded generation" body="S3 documents become tenant-filtered pgvector chunks with opaque source refs and navigable citations." /><Feature title="Inspectable evidence" body="Evidence packets connect retrieval, generation, repair, normalized checks, artifact coverage, human approval, tokens, pricing, and latency without storing raw prompts." /><Feature title="Adversarial by default" body="Requirement IDs, PII redaction, prompt-leak checks, and injection canaries run before persistence." /><Feature title="AWS-native delivery" body="CDK provisions encrypted S3, SQS + DLQ, Lambda partial-batch handling, alarms, budgets, and OIDC trust." /></div></section>

        <footer className="flex flex-col gap-3 border-t border-white/10 py-8 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>Enterprise AI Implementation Workbench · AWS-first · offline-capable</span><span>Built to make the engineering evidence easy to inspect.</span></footer>
      </div>
    </main>
  );
}

function TraceRow({ number, label, detail, tone }: { number: string; label: string; detail: string; tone: "cyan" | "indigo" | "amber" | "emerald" }) {
  const tones = { cyan: "border-cyan-300/30 bg-cyan-300/5 text-cyan-200", indigo: "border-indigo-300/30 bg-indigo-300/5 text-indigo-200", amber: "border-amber-300/30 bg-amber-300/5 text-amber-200", emerald: "border-emerald-300/30 bg-emerald-300/5 text-emerald-200" };
  return <div className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${tones[tone]}`}><span className="font-mono text-[10px] opacity-60">{number}</span><div><p className="text-xs font-semibold text-white">{label}</p><p className="mt-0.5 text-[11px] opacity-70">{detail}</p></div></div>;
}

function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-white/[0.04] px-3 py-2"><p className="text-[9px] tracking-[0.18em] text-slate-400">{label}</p><p className="mt-1 font-mono text-xs text-slate-200">{value}</p></div>; }
function Evidence({ value, label }: { value: string; label: string }) { return <div><p className="text-3xl font-semibold tracking-tight text-cyan-200">{value}</p><p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">{label}</p></div>; }
function Feature({ title, body }: { title: string; body: string }) { return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h3 className="text-sm font-semibold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{body}</p></div>; }
