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
  "landing_page_view",
  "inspection_cta_clicked",
  "funnel_started",
  "qualification_question_answered",
  "contact_information_submitted",
  "lead_created",
  "lead_qualified",
  "lead_disqualified",
  "scheduling_viewed",
  "appointment_selected",
  "inspection_booked",
  "inspection_rescheduled",
  "inspection_cancelled",
  "inspection_completed",
  "customer_won",
  "customer_lost",
  "revenue_recorded",
  "communication_attempted",
  "communication_accepted",
  "communication_delivered",
  "communication_failed",
  "communication_bounced",
  "communication_inbound",
  "communication_opted_out",
] as const;
export type FunnelEventType = (typeof FUNNEL_EVENT_TYPES)[number];

export const COMMUNICATION_TYPES = [
  "appointment_confirmation",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_reminder",
  "qualified_not_booked_follow_up",
  "inbound_reply",
  "inbound_opt_out",
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
  "attempted",
  "blocked",
  "suppressed",
  "queued",
  "accepted",
  "failed",
  "delivered",
  "bounced",
  "undeliverable",
  "received",
  "opted_out",
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
