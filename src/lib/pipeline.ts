/**
 * Canonical pipeline stages and funnel event types. Single source of truth
 * so the funnel UI, CRM, dashboard, and analytics never drift apart.
 */

export const LEAD_STATUSES = [
  "new",
  "engaged",
  "mql",
  "sql",
  "inspection_booked",
  "inspection_completed",
  "customer_won",
  "customer_lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_CLASSIFICATIONS = ["prospect", "mql", "sql"] as const;
export type LeadClassification = (typeof LEAD_CLASSIFICATIONS)[number];

export const APPOINTMENT_STATUSES = [
  "booked",
  "rescheduled",
  "cancelled",
  "no_show",
  "completed",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const FUNNEL_EVENT_TYPES = [
  "visit",
  "assessment_start",
  "contact_captured",
  "lead_created",
  "mql",
  "sql",
  "scheduler_viewed",
  "appointment_booked",
  "appointment_completed",
  "customer_won",
  "customer_lost",
] as const;
export type FunnelEventType = (typeof FUNNEL_EVENT_TYPES)[number];

export const COMMUNICATION_TYPES = [
  "appointment_confirmation",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_reminder",
  "qualified_not_booked_follow_up",
] as const;
export type CommunicationType = (typeof COMMUNICATION_TYPES)[number];

// "blocked"/"queued"/"sent"/"failed" are the only statuses this codebase
// ever writes today (no live provider is wired up — see
// docs/ARCHITECTURE.md). "delivered"/"bounced"/"undeliverable" are declared
// so a future webhook-driven provider integration has a status to update
// into without a schema change; nothing may write them until a real
// provider delivery-status webhook exists (see CLAUDE.md: never fabricate
// third-party integration data).
export const COMMUNICATION_STATUSES = [
  "blocked",
  "queued",
  "sent",
  "failed",
  "delivered",
  "bounced",
  "undeliverable",
] as const;
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number];

export const SWITCH_REASONS = [
  "pest_returned_after_treatment",
  "poor_service",
  "poor_communication",
  "missed_appointments",
  "pricing_concerns",
  "recurring_infestation",
  "wants_second_opinion",
  "considering_another_provider",
  "other",
] as const;
export type SwitchReason = (typeof SWITCH_REASONS)[number];
