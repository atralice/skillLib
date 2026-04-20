"use client";

import { useState } from "react";
import GrantToUserForm from "./GrantToUserForm";
import GrantToTeamForm from "./GrantToTeamForm";

type TeamOption = { id: string; displayName: string; name: string };

export default function GrantTargetTabs({
  skillId,
  teams,
}: {
  skillId: string;
  teams: TeamOption[];
}) {
  const [target, setTarget] = useState<"user" | "team">("user");

  return (
    <div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTarget("user")}
          className={`rounded-md border px-3 py-1 text-sm ${
            target === "user"
              ? "border-gray-900 bg-gray-900 text-white"
              : "border-gray-200 text-gray-700"
          }`}
        >
          Grant to user
        </button>
        <button
          type="button"
          onClick={() => setTarget("team")}
          className={`rounded-md border px-3 py-1 text-sm ${
            target === "team"
              ? "border-gray-900 bg-gray-900 text-white"
              : "border-gray-200 text-gray-700"
          }`}
        >
          Grant to team
        </button>
      </div>
      {target === "user" ? (
        <GrantToUserForm skillId={skillId} />
      ) : (
        <GrantToTeamForm skillId={skillId} teams={teams} />
      )}
    </div>
  );
}
