import { redirect } from "next/navigation";

export default function BusinessOnboardingRedirect() {
  redirect("/partner?role=business");
}