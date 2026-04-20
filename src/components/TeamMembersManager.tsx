"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import addTeamMemberServerAction from "@/actions/teams/addTeamMember";
import removeTeamMemberServerAction from "@/actions/teams/removeTeamMember";
import updateTeamMemberRoleServerAction from "@/actions/teams/updateTeamMemberRole";
import { isServerActionError } from "@/lib/serverActions/isServerActionError";

type Role = "owner" | "admin" | "member";

type MemberInfo = {
  id: string;
  role: Role;
  user: {
    id: string;
    username: string | null;
    firstName: string;
    lastName: string;
    email: string;
  };
};

type Props = {
  teamId: string;
  callerRole: Role;
  currentUserId: string;
  members: MemberInfo[];
};

export default function TeamMembersManager({ teamId, callerRole, currentUserId, members }: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const canAdd = callerRole === "owner" || callerRole === "admin";
  const canChangeRoles = callerRole === "owner";

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setAdding(true);

    const formData = new FormData(e.currentTarget);
    const username = String(formData.get("username") ?? "");
    const role = String(formData.get("role") ?? "member");

    const result = await addTeamMemberServerAction({
      teamId,
      username,
      role: role === "admin" ? "admin" : "member",
    });

    if (isServerActionError(result)) {
      setError(result.error.formErrors[0] ?? null);
      setFieldErrors(result.error.fieldErrors);
      setAdding(false);
      return;
    }

    setAdding(false);
    e.currentTarget.reset();
    router.refresh();
  }

  async function handleRemove(memberId: string) {
    await removeTeamMemberServerAction({ memberId });
    router.refresh();
  }

  async function handleRoleChange(memberId: string, role: Role) {
    await updateTeamMemberRoleServerAction({ memberId, role });
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      {canAdd && (
        <div className="rounded-lg border bg-white p-6">
          <h2 className="font-semibold">Add member</h2>
          <form onSubmit={handleAdd} className="mt-3 flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-medium">Username</span>
              <input
                name="username"
                required
                placeholder="their-username"
                className="rounded-md border px-3 py-2 text-sm"
              />
              {fieldErrors.username && (
                <span className="text-xs text-red-600">{fieldErrors.username[0]}</span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Role</span>
              <select
                name="role"
                defaultValue="member"
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={adding}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {adding ? "Adding..." : "Add"}
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      )}

      <div className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold">Members</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Username</th>
              <th className="pb-2 font-medium">Role</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.user.id === currentUserId;
              return (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2">
                    {m.user.firstName} {m.user.lastName}
                  </td>
                  <td className="py-2 text-gray-500">{m.user.username ?? "—"}</td>
                  <td className="py-2 text-gray-500">
                    {canChangeRoles && !isSelf ? (
                      <select
                        defaultValue={m.role}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === "owner" || value === "admin" || value === "member") {
                            void handleRoleChange(m.id, value);
                          }
                        }}
                        className="rounded-md border px-2 py-1 text-xs"
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    ) : (
                      m.role
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {(canAdd || isSelf) && (
                      <button
                        onClick={() => {
                          void handleRemove(m.id);
                        }}
                        className="text-red-600 hover:underline"
                      >
                        {isSelf ? "Leave" : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
