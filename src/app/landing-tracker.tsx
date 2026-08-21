"use client";

import { useEffect } from "react";
import { track } from "@/lib/visitor";

export default function LandingTracker() {
  useEffect(() => {
    void track("visit");
  }, []);

  return null;
}
