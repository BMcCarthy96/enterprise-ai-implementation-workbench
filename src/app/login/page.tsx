import { Suspense } from "react";
import type { Metadata } from "next";
import { DemoLaunchButton } from "@/app/DemoLaunchButton";
import { LoginForm } from "./LoginForm";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Open an interactive demo or sign in to an existing Enterprise AI Implementation Workbench workspace.",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  const configuration = env();
  const defaultConnection = configuration.OIDC_DEFAULT_CONNECTION;
  const passwordLoginEnabled = configuration.WORKBENCH_ENV_MODE !== "showcase";
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-300 text-sm font-black text-slate-950 shadow-sm">
            EA
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            Implementation Workbench
          </h1>
          <p className="mt-1 text-sm text-gray-600">Open the demo or sign in to an existing workspace.</p>
        </div>
        <div className="card p-6">
          <section aria-labelledby="demo-access-title" className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
            <h2 id="demo-access-title" className="text-sm font-semibold text-cyan-950">Try the interactive demo</h2>
            <p className="mt-1 text-xs leading-5 text-cyan-900">No account or password is needed. We will open a private workspace with sample data.</p>
            <DemoLaunchButton
              label="Open demo workspace"
              busyLabel="Preparing your demo…"
              className="btn-primary mt-3 w-full"
              errorClassName="mt-2 text-xs text-rose-700"
            />
          </section>
          {passwordLoginEnabled && (
            <>
              <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-600" aria-hidden="true">
                <span className="h-px flex-1 bg-gray-200" />
                <span>Existing workspace</span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>
              <Suspense>
                <LoginForm />
              </Suspense>
            </>
          )}
          {defaultConnection && (
            <a
              href={"/api/auth/oidc/start?connection=" + encodeURIComponent(defaultConnection)}
              className="btn-secondary mt-4 w-full"
            >
              Continue with enterprise SSO
            </a>
          )}
        </div>
        <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">Demo workspaces use sample data and expire after 60 minutes.</p>
      </div>
    </main>
  );
}
