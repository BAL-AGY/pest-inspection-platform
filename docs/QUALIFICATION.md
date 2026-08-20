# Server-Authoritative Qualification

## Source of truth

`src/lib/qualification.ts` is the central qualification contract used by the
public UI and server routes. Each question declares its stable identifier,
input type, required status, allowed options, and conditional `showIf` rule.
ZIP answers additionally require exactly five digits.

The current ordered questions are ZIP, homeowner status, pest type, severity,
existing-provider status, conditional switch reason, and timeline. The
switch-reason question is required only when `hasExistingProvider` is true.

## Public writes and progression

`POST /api/leads` validates the answer object after ownership verification and
before any Lead or FunnelEvent write. It rejects:

- unknown question IDs;
- incorrect types or malformed ZIP codes;
- values outside a question's declared options;
- more than one new answer in a request;
- an answer other than the current visible question;
- a conditional answer on an inapplicable branch; and
- requests that try to change or advance multiple answers at once.

The browser sends cumulative local answers, so unchanged prior answers are
accepted. Only the one newly reached answer advances persisted progression.
One previously reached answer may be corrected per request. The server then
sanitizes downstream answers against the corrected branch; for example,
changing existing-provider status can remove an inapplicable switch reason or
make that reason the next required answer.
Contact information may be captured before completion, but incomplete
qualification remains `prospect` and cannot expose scheduling.

Invalid submissions return HTTP 400 with `error: "invalid_qualification"`, a
stable non-sensitive code and question ID, and a homeowner-safe reason. Stack
traces and company configuration are not returned.

## Company configuration and derived facts

Service ZIP codes and supported pest types come from the active Company's
`serviceZipCodes` and `supportedPests` JSON configuration. Clients cannot
submit internal `inServiceArea`, `supportedPest`, or `contactCaptured` facts;
the server derives them from validated answers, current Company configuration,
and persisted contact fields on every relevant request.

`other` remains a valid homeowner answer because it is an explicit question
option, but it is not considered a supported service unless the Company's
authoritative supported-pest configuration includes it.

## Scoring and classification

`POST /api/leads` builds scoring input exclusively from validated question
answers and server-derived facts, then applies the Company's scoring rules and
MQL/SQL thresholds. The top-level request schema is strict: client-supplied
`score`, `classification`, `status`, or other undeclared fields are rejected.
An incomplete questionnaire is classified `prospect` even if its partial
answers would otherwise reach a threshold.

## Booking eligibility

The API response's `eligibleForBooking` flag requires all of the following:

- every applicable required question is complete;
- contact information has been captured;
- the property is homeowner-owned;
- the ZIP is in the Company's service area;
- the pest type is supported by the Company; and
- the server-computed classification is SQL.

The UI uses this response for navigation, but it is not the security boundary.
Both `GET /api/availability` and `POST /api/appointments` independently parse
stored answers, re-derive current Company eligibility, and require SQL. Thus a
stale or manually corrupted SQL classification cannot by itself expose or
consume inspection capacity.

## Current limitations

- Question definitions are code-configured; Company configuration currently
  controls service ZIPs, supported pests, scoring rules, and thresholds, but
  there is no owner-facing question editor.
- The UI does not yet expose back-navigation even though an owned API
  continuation can safely correct one prior answer at a time.
- `qualificationAnswers` remains JSON rather than normalized answer rows, so
  per-question SQL reporting is not efficient at large scale.
