import "server-only";

import { cookies } from "next/headers";
import { getUserBySession, publicUser, sessionCookieName } from "./store";

export async function getAuthenticatedUser() {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;
  const user = await getUserBySession(token);
  return user ? { record: user, publicUser: publicUser(user) } : null;
}
