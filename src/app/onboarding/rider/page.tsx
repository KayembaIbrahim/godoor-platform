import { redirect } from "next/navigation";

export default function RiderOnboardingRedirect() {
  redirect("/partner?role=rider");
}