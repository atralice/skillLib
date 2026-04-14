import type { User } from "generated/prisma/client/client";

export default function hasSystemRole(user: Pick<User, "systemRole"> | null): boolean {
  return user?.systemRole === "admin" || user?.systemRole === "staff";
}
