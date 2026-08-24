# Campaign Playbook — Recommendation Algorithm

Canonical source: `src/lib/marketing-intelligence/recommendations.ts`.
Every threshold named below is an exported, named constant
(`RECOMMENDATION_THRESHOLDS`) — nothing here is a hidden weight or an "AI
score." This is a deterministic V1: two rule sets, described in full below.

## 1. Turning evidence into a testable hypothesis (pre-campaign)

`generateOfferHypotheses(studies, metric)` compares every pair of offers
*within the same platform* (never across platforms — see
`BENCHMARKS.md`) on one metric (default: cost per booked inspection).

For each pair:

1. Compute the benchmark for each offer (`computeBenchmark`). If either
   side has insufficient evidence, skip this pair entirely.
2. Determine which offer is "better" (lower cost, or higher rate — see
   `LOWER_IS_BETTER` in the source for which metrics go which direction).
3. Compute `percentDifference` — how much better, as a fraction of the
   worse offer's median. If it's below `MEANINGFUL_DIFFERENCE_RATIO`
   (**15%**), skip this pair — too small a gap between two small samples to
   plausibly be signal rather than noise.
4. Classify **confidence**:
   - **HIGH** — the two offers' combined sample size is at least
     `HIGH_CONFIDENCE_MIN_COMBINED_SAMPLE` (**4** studies) *and* at least
     `HIGH_CONFIDENCE_MIN_HIGH_QUALITY_SHARE` (**50%**) of those studies are
     `high` evidence quality.
   - **EXPERIMENTAL** — every single contributing study is `low` evidence
     quality (regardless of sample size).
   - **MEDIUM** — everything else that cleared the minimum sample-size gate
     in step 1.
5. Produce a hypothesis card with a hedged, non-committal reason sentence —
   literally `"Existing evidence suggests X is a stronger starting
   hypothesis than Y..."`, never `"This will work."` The card always states
   the platform, both offers, both medians, the metric, the sample size, and
   `supportingStudyIds` so the owner can trace it back to the actual studies
   (`docs/marketing-intelligence/CASE-STUDY-SCHEMA.md`).

**A hypothesis never eliminates testing** — even a HIGH-confidence
hypothesis is "worth testing first," not "don't bother testing the
alternative."

## 2. Judging a running experiment against the evidence (post-data)

`recommendExperimentAction()` takes a `CampaignExperiment`'s **real,
live-computed** metrics (see `src/lib/marketing-intelligence/experiments.ts`
— never case-study data) and the matching benchmark segment, and returns one
of:

| Action | Condition |
|---|---|
| `insufficient_data` | Fewer than `MIN_EXPERIMENT_BOOKINGS_FOR_COMPARISON` (**3**) real booked inspections yet, OR no spend logged (cost-per-booked-inspection unknown), OR no compatible benchmark exists for this platform/offer |
| `scale` | Real cost per booked inspection is at least `SCALE_THRESHOLD` (**15%**) *below* the benchmark median |
| `pause` | Real cost per booked inspection is more than `PAUSE_THRESHOLD` (**50%**) *above* the benchmark median |
| `modify` | Real cost per booked inspection is between `MODIFY_THRESHOLD` (**15%**) and `PAUSE_THRESHOLD` (**50%**) above the benchmark median |
| `keep_testing` | Within ±15% of the benchmark median — not yet a clear enough signal either way |

This is the mechanism behind Phase 6's "evidence matters most early, real
data takes over as it accumulates": with 0–2 real bookings, the algorithm
*always* returns `insufficient_data` regardless of how strong the industry
evidence is — it refuses to let a benchmark override too little real
traffic. Once real bookings clear the minimum, the comparison is judged
entirely against real, live data; the case studies only supplied *which*
benchmark to compare against, never the comparison result itself.

## What this system intentionally does NOT do

- No campaign is ever paused, scaled, or modified automatically. Every
  action above is advice text in the dashboard; a human decides.
- No machine-learning model, no probability-weighted "score" that isn't a
  named threshold comparison. If a future version wants a smarter model,
  document its inputs/outputs with the same rigor as this file first.
