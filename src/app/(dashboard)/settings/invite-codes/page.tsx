import { redirect } from "next/navigation";
import getUser from "@/utils/loaders/server/user/getUser";
import hasSystemRole from "@/lib/user/hasSystemRole";
import prisma from "@/lib/prisma";
import InviteCodeManager from "@/components/InviteCodeManager";

export const dynamic = "force-dynamic";

export default async function InviteCodesPage() {
  const user = await getUser();
  if (!user) return null;
  if (!hasSystemRole(user)) {
    redirect("/settings");
  }

  const invites = await prisma.inviteCode.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      usedBy: { select: { firstName: true, lastName: true, email: true } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Invite codes</h1>
      <p className="mt-2 text-sm text-gray-500">
        Create invite codes to let new people sign up. Codes can only be used once.
      </p>
      <InviteCodeManager initialInvites={invites} />
    </div>
  );
}
