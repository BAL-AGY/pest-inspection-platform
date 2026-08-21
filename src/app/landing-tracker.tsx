"use client";

import { useEffect } from "react";
import { track } from "@/lib/visitor";

export default function LandingTracker() {
  useEffect(() => {
    void track("landing_page_view");
  }, []);

  return null;
}
