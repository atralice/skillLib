"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import createApiKeyServerAction from "@/actions/apiKeys/createApiKey";
import revokeApiKeyServerAction from "@/actions/apiKeys/revokeApiKey";
import { isServerActionError } from "@/lib/serverActions/isServerActionError";
import { useRouter } from "next/navigation";

type ApiKeyInfo = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
};

export default function ApiKeyManager({ initialKeys }: { initialKeys: ApiKeyInfo[] }) {
  const router = useRouter();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCreating(true);

    const formData = new FormData(e.currentTarget);
    const name = formData.get("name");
    if (typeof name !== "string") return;

    const result = await createApiKeyServerAction({ name });

    if (isServerActionError(result)) {
      setError(result.error.formErrors[0] ?? "Failed to create key");
      setCreating(false);
      return;
    }

    setNewKey(result.fullKey);
    setCreating(false);
    e.currentTarget.reset();
    router.refresh();
  }

  async function handleRevoke(apiKeyId: string) {
    await revokeApiKeyServerAction({ apiKeyId });
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold">Create new key</h2>
        <form onSubmit={handleCreate} className="mt-3 flex gap-3">
          <input
            name="name"
            placeholder="Key name (e.g. laptop, desktop)"
            required
            className="flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create key"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {newKey && (
          <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-4">
            <p className="text-sm font-medium text-yellow-800">
              Copy this key now — you won&apos;t see it again.
            </p>
            <code className="mt-2 block break-all rounded bg-white p-2 font-mono text-sm">
              {newKey}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(newKey);
              }}
              className="mt-2 text-sm text-yellow-700 underline"
            >
              Copy to clipboard
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold">Active keys</h2>
        {initialKeys.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">No API keys yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Key</th>
                <th className="pb-2 font-medium">Last used</th>
                <th className="pb-2 font-medium">Created</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {initialKeys.map((key) => (
                <tr key={key.id} className="border-b last:border-0">
                  <td className="py-2">{key.name}</td>
                  <td className="py-2 font-mono text-gray-400">{key.keyPrefix}...</td>
                  <td className="py-2 text-gray-500">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}
                  </td>
                  <td className="py-2 text-gray-500">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => {
                        void handleRevoke(key.id);
                      }}
                      className="text-red-600 hover:underline"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
