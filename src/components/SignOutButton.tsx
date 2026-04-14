"use client";

import { useRouter } from "next/navigation";
import signOut from "@/actions/auth/signOut";

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-sm text-gray-500 hover:text-gray-900"
    >
      Sign out
    </button>
  );
}
