"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * Client component that redirects users to the onboarding flow
 * if they haven't completed it yet. Settings pages are exempt
 * so users can configure SSO or API keys first.
 */
export function OnboardingGuard() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const completed = localStorage.getItem("onboarding_completed");
    if (!completed && !pathname.startsWith("/dashboard/settings")) {
      router.push("/onboarding");
    }
  }, [pathname, router]);

  return null;
}
