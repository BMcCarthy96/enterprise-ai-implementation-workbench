import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-lg font-bold text-white">
            W
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            Implementation Workbench
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Sign in to your workspace
          </p>
        </div>
        <div className="card p-6">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <div className="card mt-4 p-4 text-xs text-gray-500">
          <p className="mb-1.5 font-semibold text-gray-600">
            Demo accounts (password: demo1234)
          </p>
          <ul className="space-y-0.5 font-mono">
            <li>admin@northwind.dev — Operations Admin</li>
            <li>manager@northwind.dev — Implementation Manager</li>
            <li>engineer@northwind.dev — Solutions Engineer</li>
            <li>customer@brightlane.dev — Customer Stakeholder</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
