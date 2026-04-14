"use server";

import { deleteSession } from "@/lib/auth/session";

async function signOut() {
  await deleteSession();
}

export default signOut;
