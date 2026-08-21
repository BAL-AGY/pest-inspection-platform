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
  /** Backward-compatible stored/API values accepted but not offered in the current UI. */
  acceptedOptions?: QualificationOption[];
  /** Only ask this question when the predicate over prior answers is true. */
  showIf?: (answers: QualificationAnswers) => boolean;
  required: boolean;
}

export type QualificationErrorCode =
  | "unknown_question"
  | "invalid_answer_type"
  | "invalid_answer_value"
  | "invalid_progression"
  | "answer_not_applicable";

export interface QualificationValidationIssue {
  code: QualificationErrorCode;
  questionId: string;
  message: string;
}

export interface QualificationState {
  answers: QualificationAnswers;
  complete: boolean;
  nextQuestion: QualificationQuestion | null;
  inServiceArea: boolean;
  supportedPest: boolean;
  hasContact: boolean;
  eligibleForBooking: boolean;
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
      { value: "general_pest", label: "General Pest" },
      { value: "fleas", label: "Fleas" },
      { value: "rodents", label: "Rodents" },
      { value: "other", label: "Other" },
    ],
    acceptedOptions: [
      { value: "ants", label: "Ants" },
      { value: "roaches", label: "Roaches" },
      { value: "termites", label: "Termites" },
      { value: "bed_bugs", label: "Bed bugs" },
      { value: "spiders", label: "Spiders" },
      { value: "wasps", label: "Wasps/stinging insects" },
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
    if (question.showIf && !question.showIf(answers)) continue;
    if (question.id in answers && !validateAnswerValue(question, answers[question.id])) continue;
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

function questionById(id: string): QualificationQuestion | undefined {
  return QUALIFICATION_QUESTIONS.find((question) => question.id === id);
}

function validateAnswerValue(
  question: QualificationQuestion,
  value: unknown,
): QualificationValidationIssue | null {
  if (question.type === "boolean") {
    return typeof value === "boolean"
      ? null
      : {
          code: "invalid_answer_type",
          questionId: question.id,
          message: "This answer must be yes or no.",
        };
  }

  if (typeof value !== "string") {
    return {
      code: "invalid_answer_type",
      questionId: question.id,
      message: "This answer must be text.",
    };
  }

  if (question.type === "zip") {
    return /^\d{5}$/.test(value)
      ? null
      : {
          code: "invalid_answer_value",
          questionId: question.id,
          message: "Enter a valid 5-digit ZIP code.",
        };
  }

  if (question.type === "text") {
    return value.trim().length > 0 && value.length <= 500
      ? null
      : {
          code: "invalid_answer_value",
          questionId: question.id,
          message: "Enter a valid answer.",
        };
  }

  const allowed = [...(question.options ?? []), ...(question.acceptedOptions ?? [])]
    .some((option) => option.value === value);
  return allowed
    ? null
    : {
        code: "invalid_answer_value",
        questionId: question.id,
        message: "Select one of the available options.",
      };
}

/**
 * Validate one public qualification write against the authoritative ordered
 * question definition. Existing answers may be repeated unchanged (the UI
 * sends cumulative state). A request may advance by only the current visible
 * question. One previously reached answer may also be corrected; downstream
 * state is then sanitized against the corrected conditional path.
 */
export function validateQualificationSubmission(input: {
  priorAnswers: QualificationAnswers;
  submittedAnswers: Record<string, unknown>;
}):
  | { success: true; answers: QualificationAnswers }
  | { success: false; issue: QualificationValidationIssue } {
  const prior = extractValidQuestionAnswers(input.priorAnswers);
  const submittedEntries = Object.entries(input.submittedAnswers);

  for (const [questionId, value] of submittedEntries) {
    const question = questionById(questionId);
    if (!question) {
      return {
        success: false,
        issue: {
          code: "unknown_question",
          questionId,
          message: "This qualification question is not recognized.",
        },
      };
    }
    const issue = validateAnswerValue(question, value);
    if (issue) return { success: false, issue };
  }

  const newEntries = submittedEntries.filter(([questionId, value]) => {
    if (!(questionId in prior)) return true;
    return prior[questionId] !== value;
  });

  if (newEntries.length > 1) {
    return {
      success: false,
      issue: {
        code: "invalid_progression",
        questionId: newEntries[1][0],
        message: "Complete qualification questions in order.",
      },
    };
  }

  if (newEntries.length === 1) {
    const [questionId, value] = newEntries[0];
    if (questionId in prior) {
      return {
        success: true,
        answers: extractValidQuestionAnswers({
          ...prior,
          [questionId]: value as string | boolean,
        }),
      };
    }

    const expected = getNextQuestion(prior);
    if (!expected || expected.id !== questionId) {
      const question = questionById(questionId);
      return {
        success: false,
        issue: {
          code: question?.showIf && !question.showIf(prior)
            ? "answer_not_applicable"
            : "invalid_progression",
          questionId,
          message: question?.showIf && !question.showIf(prior)
            ? "This question does not apply to the current qualification path."
            : "Complete qualification questions in order.",
        },
      };
    }
    return {
      success: true,
      answers: {
        ...prior,
        [questionId]: value as string | boolean,
      },
    };
  }

  return { success: true, answers: prior };
}

/** Only declared, well-typed question answers may enter scoring. */
export function extractValidQuestionAnswers(raw: QualificationAnswers): QualificationAnswers {
  const answers: QualificationAnswers = {};
  for (const question of QUALIFICATION_QUESTIONS) {
    if (question.showIf && !question.showIf(answers)) continue;
    const value = raw[question.id];
    // Stop at the first missing/invalid visible question. This prevents
    // legacy or manually-corrupted JSON with later answers from becoming a
    // progression shortcut when the missing answer is subsequently filled.
    if (value === undefined || validateAnswerValue(question, value)) break;
    answers[question.id] = value;
  }
  return answers;
}

export function parseStoredQualificationAnswers(raw: string | null): QualificationAnswers {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as QualificationAnswers)
      : {};
  } catch {
    return {};
  }
}

/**
 * Rebuild qualification and booking eligibility from stored answers plus
 * current company configuration. Callers never trust persisted derived flags.
 */
export function deriveQualificationState(input: {
  answers: QualificationAnswers;
  serviceZipCodes: string[];
  supportedPests: string[];
  hasContact: boolean;
}): QualificationState {
  const answers = extractValidQuestionAnswers(input.answers);
  const nextQuestion = getNextQuestion(answers);
  const complete = nextQuestion === null;
  const zipCode = typeof answers.zipCode === "string" ? answers.zipCode : undefined;
  const pestType = typeof answers.pestType === "string" ? answers.pestType : undefined;
  const inServiceArea = isInServiceArea(zipCode, input.serviceZipCodes);
  const supportedPest = Boolean(pestType && input.supportedPests.includes(pestType));

  return {
    answers,
    complete,
    nextQuestion,
    inServiceArea,
    supportedPest,
    hasContact: input.hasContact,
    eligibleForBooking:
      complete &&
      input.hasContact &&
      inServiceArea &&
      supportedPest &&
      answers.isHomeowner === true,
  };
}

/**
 * We never advise a prospect to violate an existing provider's contract.
 * This is the single copy source for switcher-path messaging so that rule
 * can't drift across UI surfaces.
 */
export const SWITCHER_DISCLAIMER =
  "We're happy to give you a free second opinion. If you're still under contract with another provider, please review your agreement's terms — we won't advise you on ending it early.";
