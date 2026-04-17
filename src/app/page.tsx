import { redirect } from "next/navigation";
import getUser from "@/utils/loaders/server/user/getUser";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getUser();
  if (user) {
    redirect("/dashboard");
  }
  redirect("/login");
}
