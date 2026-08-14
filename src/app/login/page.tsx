import { Suspense } from "react";
import { LoginForm } from "./LoginForm";
import { env } from "@/lib/env";

export default function LoginPage() {
  const defaultConnection = env().OIDC_DEFAULT_CONNECTION;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f2f6fb] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-300 text-sm font-black text-slate-950 shadow-sm">
            EA
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            Implementation Workbench
          </h1>
          <p className="mt-1 text-sm text-gray-600">Secure access to delivery, evidence, and governance</p>
        </div>
        <div className="card p-6">
          <Suspense>
            <LoginForm />
          </Suspense>
          {defaultConnection && (
            <a
              href={"/api/auth/oidc/start?connection=" + encodeURIComponent(defaultConnection)}
              className="btn-secondary mt-4 w-full"
            >
              Continue with enterprise SSO
            </a>
          )}
        </div>
        <p className="mt-4 text-center text-xs leading-5 text-gray-500">For local evaluation, use the seeded accounts documented in the repository README. Public reviewers should use the isolated demo launcher.</p>
      </div>
    </main>
  );
}
