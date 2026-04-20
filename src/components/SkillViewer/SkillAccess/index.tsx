import GrantTargetTabs from "./GrantTargetTabs";
import SkillGrantsList from "./SkillGrantsList";
import type { GrantInfo } from "./SkillGrantsList";

type TeamOption = { id: string; displayName: string; name: string };

type Props = {
  skillId: string;
  visibility: string;
  grants: GrantInfo[];
  ownedTeams: TeamOption[];
};

export default function SkillAccess({
  skillId,
  visibility,
  grants,
  ownedTeams,
}: Props) {
  return (
    <div className="rounded-lg border bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Access
      </h2>
      <p className="mt-2 text-sm text-gray-500">
        {visibility === "public"
          ? "This skill is public — everyone can see it. Grants still work for convenience."
          : "Only the owner, the assigned team, and grantees below can see this skill."}
      </p>
      <div className="mt-4">
        <GrantTargetTabs skillId={skillId} teams={ownedTeams} />
      </div>
      <div className="mt-4">
        <SkillGrantsList grants={grants} />
      </div>
    </div>
  );
}
