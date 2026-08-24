# Benchmark Engine

Canonical source: `src/lib/marketing-intelligence/benchmarks.ts`.

## Two hard rules

1. **Never mix incompatible studies.** A benchmark is always computed over
   one specific segment — e.g. `platform=meta AND offer=free_inspection`.
   There is no "overall industry average" blending different platforms,
   offers, or pest categories together. `computeBenchmark()` takes an
   explicit `segment` filter and only ever includes studies matching every
   condition in it.
2. **Never show a number without enough evidence.** `MIN_BENCHMARK_SAMPLE_SIZE`
   (currently `2`) is the minimum number of compatible studies — that also
   report the specific metric being asked for — required before a median is
   computed. Below that, the result is `{ insufficientEvidence: true, median:
   null, ... }`. The UI renders "Insufficient benchmark data" for that case,
   never a number derived from too little evidence.

## What gets computed

For a `(segment, metric)` pair:

1. Filter case studies to those matching every field in `segment`
   (`platform`, `offer`, `pestCategory`, `serviceType` — only the fields you
   pass are checked).
2. For each matching study, resolve the metric via `deriveMetric()` — the
   study's own directly-reported value if present, otherwise a value derived
   from two of that same study's other reported numbers (see
   `CASE-STUDY-SCHEMA.md` → "Derived metrics"). A study that has neither is
   excluded from this metric's sample — never counted as zero.
3. If fewer than `MIN_BENCHMARK_SAMPLE_SIZE` studies produced a value,
   return `insufficientEvidence: true`.
4. Otherwise return the **median**, **min**, and **max** across those
   values, the sample size, and how many of the contributing studies were
   `high`/`medium`/`low` evidence quality (`evidenceQualityCounts`) — the
   recommendation engine uses that quality mix, not just the count, to set
   confidence.

Median (not mean) is used deliberately — pest-control case-study sample
sizes are small, and a median is far less sensitive to one outlier study
than a mean would be.

## Standard benchmark segments

`computeStandardBenchmarks()` is what the "Industry benchmarks" section of
the Acquisition Intelligence dashboard actually calls. It computes, for
every platform and every offer that appears in the loaded case studies, the
same five metrics (`cplCents`, `bookingRate`, `costPerBookedInspectionCents`,
`cacCents`, `roas`), and returns only the results that clear the sample-size
gate. With zero case studies imported, this returns an empty array — the
correct, honest empty state, not a placeholder.

## Adding a new segment or metric

Add a new `DerivedMetricKey` (and its `deriveMetric()` case) or a new
`BenchmarkSegmentFilter` field and thread it through `matchesSegment()`.
Never add a metric that has to be estimated to exist — every metric here
must be either directly reported by at least some studies or arithmetically
derivable from two numbers a study actually reported.
