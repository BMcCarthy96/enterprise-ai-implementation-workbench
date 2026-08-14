import Link from "next/link";
import { PrintCaseStudyButton } from "@/app/PrintCaseStudyButton";
import {
  getProofManifest,
  proofStatusLabels,
  type ProofStatus,
} from "@/lib/proof";

export const metadata = {
  title: "Enterprise AI Workbench — case study",
  description: "Printable portfolio case study and evidence index.",
};

export default function CaseStudyPage() {
  const manifest = getProofManifest();
  const statuses: ProofStatus[] = [
    "ci_verified",
    "staging_observed",
    "implemented",
    "target",
    "planned",
  ];
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-4xl px-6 py-10 print:max-w-none print:px-0">
        <header className="flex items-start justify-between gap-6 border-b border-gray-200 pb-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
              Portfolio case study
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              Enterprise AI Implementation Workbench
            </h1>
            <p className="mt-3 max-w-2xl text-lg leading-8 text-gray-600">
              A governed implementation workflow that turns messy requirements
              into grounded, reviewable delivery work while keeping people
              accountable for the decision.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <PrintCaseStudyButton />
            <Link
              href="/proof"
              className="text-sm text-indigo-600 hover:underline print:hidden"
            >
              Back to proof hub
            </Link>
          </div>
        </header>

        <section className="grid gap-6 border-b border-gray-200 py-8 md:grid-cols-3">
          <Metric label="Proof claims" value={String(manifest.claims.length)} />
          <Metric
            label="Offline eval cases"
            value={String(manifest.evaluation.caseCount)}
          />
          <Metric
            label="Build provenance"
            value={
              manifest.provenance.currentBuildVerified
                ? `CI · ${manifest.build.commit.slice(0, 8)}`
                : manifest.build.commit === "local"
                  ? "Local · unverified"
                  : "Source evidence"
            }
          />
        </section>

        <section className="max-w-none py-10 text-sm leading-7 text-gray-700 [&_a]:font-medium [&_a]:text-indigo-700 [&_a]:underline [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-950 [&_h2:first-child]:mt-0 [&_li]:pl-1 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:mt-3 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
          <h2>Context</h2>
          <p>
            Implementation teams receive requirements in inconsistent formats,
            then spend time translating them into scope, plans, tasks, customer
            updates, and operational handoffs. The Workbench makes that
            translation inspectable: retrieval sources become opaque citations,
            model output is schema-validated, repair is recorded as evidence,
            and no delivery mutation happens before a human approval.
          </p>
          <h2>What is interesting technically</h2>
          <ul>
            <li>
              Multi-tenant boundaries are repeated in RBAC, application queries,
              transaction-local RLS, private S3 keys, and isolated demo
              workspaces.
            </li>
            <li>
              Asynchronous work is durable: Postgres is the source of truth, SQS
              carries only a job pointer, per-claim fencing protects
              transactional database writes, and a durable attempt ledger makes
              retries and dead letters inspectable.
            </li>
            <li>
              AI quality is an evidence packet, not a single score: retrieval,
              redaction, schema validity, citation coverage, injection checks,
              cost, latency, repair, and reviewer outcome are linked.
            </li>
            <li>
              Enterprise controls are explicit: OIDC with PKCE, SCIM lifecycle
              APIs, encrypted secrets, signed webhooks, bounded retention, trace
              correlation, and a local observability profile.
            </li>
          </ul>
          <h2>How to evaluate the demo</h2>
          <ol>
            <li>
              Open the{" "}
              <Link href="/demo?checkpoint=ai-evidence">
                grounded AI checkpoint
              </Link>{" "}
              and inspect retrieval and repair evidence.
            </li>
            <li>
              Use the role dock to switch to the manager, approve the pending
              plan, and watch milestones/tasks materialize.
            </li>
            <li>
              Open Operations to show a seeded dead-letter job, retry path, and
              the separated reliability targets.
            </li>
            <li>
              Switch to the customer persona and confirm the timeline exposes
              published delivery state without internal rejection or prompt
              detail.
            </li>
          </ol>
          <h2>Scope and ownership</h2>
          <p>
            This repository is an end-to-end portfolio implementation: product
            workflow, multi-tenant data model, AI evidence pipeline,
            background-job reliability, enterprise control APIs,
            infrastructure-as-code, tests, and recruiter-facing proof are
            maintained together so architectural claims remain inspectable.
          </p>
          <h2>Constraints and tradeoffs</h2>
          <p>
            The default path is intentionally reproducible without paid cloud
            credentials: LocalStack, PostgreSQL, deterministic mock generation,
            and synthetic tenants exercise the same boundaries as the AWS shape.
            Live-provider cost and staging reliability are withheld unless
            matching telemetry and CI provenance are attached, and generation
            remains a proposal until a separate reviewer approves it.
          </p>
        </section>

        <section className="border-t border-gray-200 py-8">
          <h2 className="text-xl font-semibold">Evidence index</h2>
          <div className="mt-4 space-y-4">
            {statuses.map((status) => {
              const claims = manifest.claims.filter(
                (claim) => claim.status === status,
              );
              if (!claims.length) return null;
              return (
                <div key={status}>
                  <h3 className="text-sm font-semibold text-gray-700">
                    {proofStatusLabels[status]}
                  </h3>
                  <ul className="mt-2 grid gap-2 md:grid-cols-2">
                    {claims.map((claim) => (
                      <li
                        key={claim.id}
                        className="rounded-lg border border-gray-200 p-3"
                      >
                        <p className="font-medium">{claim.title}</p>
                        <ul className="mt-2 space-y-1 text-xs text-indigo-700">
                          {claim.evidence.map((item) => (
                            <li key={`${claim.id}-${item.label}`}>
                              <Link
                                href={item.href}
                                className="hover:underline"
                              >
                                {item.kind.toUpperCase()} · {item.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="border-t border-gray-200 pt-6 text-xs text-gray-600">
          <p>
            Synthetic data only · statuses are intentionally honest ·{" "}
            {manifest.provenance.currentBuildVerified
              ? `verified at commit ${manifest.build.commit}`
              : manifest.provenance.reason}
          </p>
          <p className="mt-2">
            <Link
              href="https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench"
              className="text-indigo-700 hover:underline"
            >
              Source repository and reproducibility instructions ↗
            </Link>
          </p>
        </footer>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-600">{label}</p>
      <p className="mt-1 font-mono text-xl text-gray-900">{value}</p>
    </div>
  );
}
