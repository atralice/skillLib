"use client";

import { useRouter } from "next/navigation";
import revokeSkillAccessServerAction from "@/actions/skillGrants/revokeSkillAccess";

export type GrantInfo = {
  id: string;
  user: { username: string | null; firstName: string; lastName: string } | null;
  team: { name: string; displayName: string } | null;
};

export default function SkillGrantsList({ grants }: { grants: GrantInfo[] }) {
  const router = useRouter();

  async function handleRevoke(grantId: string) {
    await revokeSkillAccessServerAction({ grantId });
    router.refresh();
  }

  if (grants.length === 0) {
    return <p className="text-sm text-gray-400">No grants yet.</p>;
  }

  return (
    <ul className="divide-y">
      {grants.map((g) => (
        <li key={g.id} className="flex items-center justify-between py-2 text-sm">
          <div>
            {g.user && (
              <>
                <span className="font-medium">
                  {g.user.firstName} {g.user.lastName}
                </span>
                {g.user.username && (
                  <span className="ml-2 text-xs text-gray-400">
                    @{g.user.username}
                  </span>
                )}
              </>
            )}
            {g.team && (
              <>
                <span className="font-medium">{g.team.displayName}</span>
                <span className="ml-2 text-xs text-gray-400">team</span>
              </>
            )}
          </div>
          <button
            onClick={() => {
              void handleRevoke(g.id);
            }}
            className="text-red-600 hover:underline"
          >
            Revoke
          </button>
        </li>
      ))}
    </ul>
  );
}
