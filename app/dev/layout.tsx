import { notFound } from "next/navigation";

// /dev/* pages render fixture data for building and QA the client. They must
// never be mistaken for the game: hidden in production unless test mode is on.
export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.POLIS_TEST_MODE !== "1") notFound();
  return children;
}
