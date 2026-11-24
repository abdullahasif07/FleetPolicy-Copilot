import type { Metadata } from "next";
import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Onboard a client" };

export default function OnboardClientPage() {
  return <OnboardingWizard />;
}
