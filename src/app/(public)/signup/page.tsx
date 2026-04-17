"use client";

import { Suspense, useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import signUp from "@/actions/auth/signUp";
import { isServerActionError } from "@/lib/serverActions/isServerActionError";

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-sm pt-16">Loading…</div>}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledCode = searchParams.get("code") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const result = await signUp({
      email: formData.get("email"),
      password: formData.get("password"),
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      inviteCode: formData.get("inviteCode"),
    });

    if (isServerActionError(result)) {
      setError(result.error.formErrors[0] ?? null);
      setFieldErrors(result.error.fieldErrors);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div className="mx-auto max-w-sm pt-16">
      <h1 className="text-2xl font-bold">Create an account</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-medium">First name</span>
            <input name="firstName" required className="rounded-md border px-3 py-2 text-sm" />
            {fieldErrors.firstName && (
              <span className="text-xs text-red-600">{fieldErrors.firstName[0]}</span>
            )}
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-medium">Last name</span>
            <input name="lastName" required className="rounded-md border px-3 py-2 text-sm" />
            {fieldErrors.lastName && (
              <span className="text-xs text-red-600">{fieldErrors.lastName[0]}</span>
            )}
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            className="rounded-md border px-3 py-2 text-sm"
          />
          {fieldErrors.email && (
            <span className="text-xs text-red-600">{fieldErrors.email[0]}</span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            className="rounded-md border px-3 py-2 text-sm"
          />
          {fieldErrors.password && (
            <span className="text-xs text-red-600">{fieldErrors.password[0]}</span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Invite code</span>
          <input
            name="inviteCode"
            required
            defaultValue={prefilledCode}
            className="rounded-md border px-3 py-2 text-sm"
          />
          {fieldErrors.inviteCode && (
            <span className="text-xs text-red-600">{fieldErrors.inviteCode[0]}</span>
          )}
        </label>
        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-md bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link href="/login" className="text-gray-900 underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
