import type { QualificationAnswers } from "./scoring";

export type QuestionType = "single_select" | "text" | "zip" | "boolean";

export interface QualificationOption {
  value: string;
  label: string;
}

export interface QualificationQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: QualificationOption[];
  /** Only ask this question when the predicate over prior answers is true. */
  showIf?: (answers: QualificationAnswers) => boolean;
  required: boolean;
}

/**
 * The progressive, conditional qualification funnel. Order matters — each
 * question narrows in on whether this is a real, in-area, ready-to-book
 * homeowner, and branches into the existing-provider/switcher path when
 * relevant.
 */
export const QUALIFICATION_QUESTIONS: QualificationQuestion[] = [
  {
    id: "zipCode",
    type: "zip",
    prompt: "What's the ZIP code of the property you'd like inspected?",
    required: true,
  },
  {
    id: "isHomeowner",
    type: "boolean",
    prompt: "Do you own this home?",
    required: true,
  },
  {
    id: "pestType",
    type: "single_select",
    prompt: "What pest issue are you dealing with?",
    options: [
      { value: "ants", label: "Ants" },
      { value: "roaches", label: "Roaches" },
      { value: "termites", label: "Termites" },
      { value: "rodents", label: "Rodents (mice/rats)" },
      { value: "bed_bugs", label: "Bed bugs" },
      { value: "spiders", label: "Spiders" },
      { value: "wasps", label: "Wasps/stinging insects" },
      { value: "other", label: "Something else" },
    ],
    required: true,
  },
  {
    id: "pestSeverity",
    type: "single_select",
    prompt: "How would you describe the problem?",
    options: [
      { value: "just_noticed", label: "Just noticed a few" },
      { value: "ongoing", label: "It's been ongoing" },
      { value: "severe", label: "It's a serious infestation" },
    ],
    required: true,
  },
  {
    id: "hasExistingProvider",
    type: "boolean",
    prompt: "Do you currently pay for pest control service from another company?",
    required: true,
  },
  {
    id: "switchReason",
    type: "single_select",
    prompt: "What's prompting you to look at other options?",
    showIf: (answers) => answers.hasExistingProvider === true,
    options: [
      {
        value: "pest_returned_after_treatment",
        label: "Pests keep coming back after their treatment",
      },
      { value: "poor_service", label: "Poor service" },
      { value: "poor_communication", label: "Poor communication" },
      { value: "missed_appointments", label: "They've missed appointments" },
      { value: "pricing_concerns", label: "Pricing concerns" },
      { value: "recurring_infestation", label: "Recurring infestation" },
      { value: "wants_second_opinion", label: "Just want a second opinion" },
      { value: "considering_another_provider", label: "Comparing other providers" },
      { value: "other", label: "Other" },
    ],
    required: true,
  },
  {
    id: "timeline",
    type: "single_select",
    prompt: "When would you like this addressed?",
    options: [
      { value: "asap", label: "As soon as possible" },
      { value: "this_week", label: "This week" },
      { value: "this_month", label: "This month" },
      { value: "just_researching", label: "Just researching for now" },
    ],
    required: true,
  },
];

/**
 * Returns the next question to ask given answers so far, honoring showIf
 * conditions, or null when the funnel is complete.
 */
export function getNextQuestion(
  answers: QualificationAnswers,
): QualificationQuestion | null {
  for (const question of QUALIFICATION_QUESTIONS) {
    if (question.id in answers) continue;
    if (question.showIf && !question.showIf(answers)) continue;
    return question;
  }
  return null;
}

export function isFunnelComplete(answers: QualificationAnswers): boolean {
  return getNextQuestion(answers) === null;
}

/**
 * Service-area validation: a lead only qualifies for a bookable inspection
 * if their ZIP is one the company actually services.
 */
export function isInServiceArea(
  zipCode: string | undefined,
  serviceZipCodes: string[],
): boolean {
  if (!zipCode) return false;
  return serviceZipCodes.includes(zipCode.trim());
}

/**
 * We never advise a prospect to violate an existing provider's contract.
 * This is the single copy source for switcher-path messaging so that rule
 * can't drift across UI surfaces.
 */
export const SWITCHER_DISCLAIMER =
  "We're happy to give you a free second opinion. If you're still under contract with another provider, please review your agreement's terms — we won't advise you on ending it early.";
