"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import createInviteCodeServerAction from "@/actions/inviteCodes/createInviteCode";
import revokeInviteCodeServerAction from "@/actions/inviteCodes/revokeInviteCode";
import { isServerActionError } from "@/lib/serverActions/isServerActionError";

type InviteInfo = {
  id: string;
  code: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  usedBy: { firstName: string; lastName: string; email: string } | null;
  createdBy: { firstName: string; lastName: string } | null;
};

function inviteStatus(invite: InviteInfo): {
  label: string;
  className: string;
} {
  if (invite.usedBy) {
    return {
      label: `Used by ${invite.usedBy.firstName} ${invite.usedBy.lastName}`,
      className: "text-gray-500",
    };
  }
  if (invite.revokedAt) {
    return { label: "Revoked", className: "text-red-600" };
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return { label: "Expired", className: "text-gray-400" };
  }
  return { label: "Unused", className: "text-green-700" };
}

export default function InviteCodeManager({ initialInvites }: { initialInvites: InviteInfo[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCreating(true);

    const formData = new FormData(e.currentTarget);
    const expiresAtRaw = formData.get("expiresAt");
    const expiresAt =
      typeof expiresAtRaw === "string" && expiresAtRaw.length > 0
        ? new Date(expiresAtRaw).toISOString()
        : undefined;

    const result = await createInviteCodeServerAction(expiresAt ? { expiresAt } : {});

    if (isServerActionError(result)) {
      setError(result.error.formErrors[0] ?? "Failed to create invite");
      setCreating(false);
      return;
    }

    setLastCreatedCode(result.code);
    setCreating(false);
    e.currentTarget.reset();
    router.refresh();
  }

  async function handleRevoke(inviteCodeId: string) {
    await revokeInviteCodeServerAction({ inviteCodeId });
    router.refresh();
  }

  const signupLink =
    lastCreatedCode && typeof window !== "undefined"
      ? `${window.location.origin}/signup?code=${encodeURIComponent(lastCreatedCode)}`
      : null;

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold">Create invite</h2>
        <form onSubmit={handleCreate} className="mt-3 flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-medium">Expires at (optional)</span>
            <input
              name="expiresAt"
              type="datetime-local"
              className="rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create invite"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {lastCreatedCode && (
          <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-4">
            <p className="text-sm font-medium text-yellow-800">
              Share this invite link with your friend.
            </p>
            <code className="mt-2 block break-all rounded bg-white p-2 font-mono text-sm">
              {signupLink ?? lastCreatedCode}
            </code>
            <button
              onClick={() => {
                if (signupLink) void navigator.clipboard.writeText(signupLink);
              }}
              className="mt-2 text-sm text-yellow-700 underline"
            >
              Copy link
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold">All invites</h2>
        {initialInvites.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">No invite codes yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Code</th>
                <th className="pb-2 font-medium">Created by</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Created</th>
                <th className="pb-2 font-medium">Expires</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {initialInvites.map((invite) => {
                const status = inviteStatus(invite);
                const canRevoke = !invite.usedBy && !invite.revokedAt;
                return (
                  <tr key={invite.id} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{invite.code}</td>
                    <td className="py-2 text-gray-500">
                      {invite.createdBy
                        ? `${invite.createdBy.firstName} ${invite.createdBy.lastName}`
                        : "—"}
                    </td>
                    <td className={`py-2 ${status.className}`}>{status.label}</td>
                    <td className="py-2 text-gray-500">
                      {new Date(invite.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-gray-500">
                      {invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="py-2 text-right">
                      {canRevoke && (
                        <button
                          onClick={() => {
                            void handleRevoke(invite.id);
                          }}
                          className="text-red-600 hover:underline"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
