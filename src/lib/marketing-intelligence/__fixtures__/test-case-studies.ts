import type { CaseStudy } from "../case-study-schema";

// TEST/FIXTURE DATA ONLY. These are synthetic, made-up numbers used solely
// to exercise the benchmark/recommendation engines in unit tests. They live
// under __fixtures__ (never under docs/marketing-intelligence/case-studies/,
// which is the only directory loadCaseStudies() reads), so they can never
// appear in the production dashboard as real evidence. Every "sourceUrl"
// below is a fake example.com link — do not treat any of this as real.

export const FIXTURE_metaFreeInspectionHigh1: CaseStudy = {
  id: "fixture-meta-free-inspection-high-1",
  companyOrCampaignName: "Fixture Co A",
  pestCategory: "general_pest",
  platform: "meta",
  campaignObjective: "leads",
  targetAudience: null,
  offer: "free_inspection",
  cta: "Book Now",
  creativeType: "video",
  hookOrMessage: null,
  landingPageStrategy: null,
  targetingStrategy: null,
  serviceType: "recurring",
  seasonality: null,
  testingDurationDays: 30,
  geography: "Fixture Region",
  reportedAdSpendCents: 100000,
  reportedImpressions: 500000,
  reportedClicks: 5000,
  reportedCtr: 0.01,
  reportedCpcCents: 20,
  reportedLeads: 200,
  reportedCplCents: 500,
  reportedBookedInspections: 80,
  reportedBookingRate: 0.4,
  reportedCustomers: 40,
  reportedCacCents: 2500,
  reportedRevenueCents: 400000,
  reportedRoas: 4,
  reportedResult: "Free inspection offer outperformed control.",
  notes: null,
  limitations: null,
  sourceTitle: "Fixture Case Study A",
  sourceUrl: "https://example.com/fixture-a",
  publisher: "Fixture Publisher",
  publicationDate: "2025-01-01",
  dateAccessed: "2025-06-01",
  evidenceQuality: "high",
  evidenceQualityReason: "Fixture: documented methodology and numeric results.",
};

export const FIXTURE_metaFreeInspectionHigh2: CaseStudy = {
  ...FIXTURE_metaFreeInspectionHigh1,
  id: "fixture-meta-free-inspection-high-2",
  companyOrCampaignName: "Fixture Co B",
  reportedAdSpendCents: 80000,
  reportedLeads: 150,
  reportedCplCents: 533,
  reportedBookedInspections: 60,
  reportedBookingRate: 0.4,
  reportedCustomers: 30,
  reportedCacCents: 2666,
  reportedRoas: 3.5,
  sourceUrl: "https://example.com/fixture-b",
};

export const FIXTURE_metaContactUsLow1: CaseStudy = {
  ...FIXTURE_metaFreeInspectionHigh1,
  id: "fixture-meta-contact-us-low-1",
  companyOrCampaignName: "Fixture Co C",
  offer: "contact_us",
  reportedAdSpendCents: 100000,
  reportedLeads: 100,
  reportedCplCents: 1000,
  reportedBookedInspections: 25,
  reportedBookingRate: 0.25,
  reportedCustomers: 10,
  reportedCacCents: 10000,
  reportedRoas: 1.2,
  evidenceQuality: "low",
  evidenceQualityReason: "Fixture: vague methodology, self-reported claim only.",
  sourceUrl: "https://example.com/fixture-c",
};

export const FIXTURE_metaContactUsLow2: CaseStudy = {
  ...FIXTURE_metaContactUsLow1,
  id: "fixture-meta-contact-us-low-2",
  companyOrCampaignName: "Fixture Co D",
  sourceUrl: "https://example.com/fixture-d",
};

// A single-study segment — deliberately below MIN_BENCHMARK_SAMPLE_SIZE, used
// to test that "insufficient evidence" is returned rather than a computed
// number from one data point.
export const FIXTURE_googleTermiteSingle: CaseStudy = {
  ...FIXTURE_metaFreeInspectionHigh1,
  id: "fixture-google-termite-single",
  pestCategory: "termite",
  platform: "google_search",
  offer: "free_inspection",
  sourceUrl: "https://example.com/fixture-e",
};

// A study that reported almost nothing numerically — exercises the
// "missing values stay null, never fabricated" requirement end to end.
export const FIXTURE_sparseData: CaseStudy = {
  id: "fixture-sparse-data",
  companyOrCampaignName: null,
  pestCategory: "mosquito",
  platform: "seo",
  campaignObjective: null,
  targetAudience: null,
  offer: null,
  cta: null,
  creativeType: null,
  hookOrMessage: null,
  landingPageStrategy: null,
  targetingStrategy: null,
  serviceType: "unknown",
  seasonality: null,
  testingDurationDays: null,
  geography: null,
  reportedAdSpendCents: null,
  reportedImpressions: null,
  reportedClicks: null,
  reportedCtr: null,
  reportedCpcCents: null,
  reportedLeads: null,
  reportedCplCents: null,
  reportedBookedInspections: null,
  reportedBookingRate: null,
  reportedCustomers: null,
  reportedCacCents: null,
  reportedRevenueCents: null,
  reportedRoas: null,
  reportedResult: "Mentioned improved rankings without numbers.",
  notes: null,
  limitations: "No quantitative data reported.",
  sourceTitle: "Fixture Sparse Study",
  sourceUrl: "https://example.com/fixture-sparse",
  publisher: "Fixture Publisher",
  publicationDate: null,
  dateAccessed: "2025-06-01",
  evidenceQuality: "low",
  evidenceQualityReason: "Fixture: no numeric results reported at all.",
};

export const ALL_FIXTURE_STUDIES: CaseStudy[] = [
  FIXTURE_metaFreeInspectionHigh1,
  FIXTURE_metaFreeInspectionHigh2,
  FIXTURE_metaContactUsLow1,
  FIXTURE_metaContactUsLow2,
  FIXTURE_googleTermiteSingle,
  FIXTURE_sparseData,
];
