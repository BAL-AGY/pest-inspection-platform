import { z } from "zod";

export const SERVICE_ARRANGEMENTS = ["ONE_TIME", "QUARTERLY", "BIMONTHLY"] as const;
export type ServiceArrangement = (typeof SERVICE_ARRANGEMENTS)[number];

export function isServiceArrangement(value: string): value is ServiceArrangement {
  return (SERVICE_ARRANGEMENTS as readonly string[]).includes(value);
}

const categorySchema = z.object({
  id: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  pestTypes: z.array(z.string().min(1).max(50)).min(1),
  potentialValueMinCents: z.number().int().nonnegative().nullable(),
  potentialValueMaxCents: z.number().int().nonnegative().nullable(),
  potentialValueOpenEnded: z.boolean().default(false),
});

export type PestCategory = z.infer<typeof categorySchema>;

export const DEFAULT_PEST_CATEGORIES: PestCategory[] = [
  {
    id: "general_pest",
    label: "General Pest",
    pestTypes: ["general_pest", "ants", "roaches", "spiders", "wasps"],
    potentialValueMinCents: 20_000,
    potentialValueMaxCents: 100_000,
    potentialValueOpenEnded: false,
  },
  {
    id: "fleas",
    label: "Fleas",
    pestTypes: ["fleas"],
    potentialValueMinCents: 40_000,
    potentialValueMaxCents: 100_000,
    potentialValueOpenEnded: false,
  },
  {
    id: "rodents",
    label: "Rodents",
    pestTypes: ["rodents"],
    potentialValueMinCents: 25_000,
    potentialValueMaxCents: 500_000,
    potentialValueOpenEnded: true,
  },
  {
    id: "other",
    label: "Other",
    pestTypes: ["other", "termites", "bed_bugs"],
    potentialValueMinCents: null,
    potentialValueMaxCents: null,
    potentialValueOpenEnded: false,
  },
];

export function parsePestCategories(company: { pestCategoryConfig?: string | null }): PestCategory[] {
  if (!company.pestCategoryConfig) return DEFAULT_PEST_CATEGORIES;
  try {
    const parsed = z.array(categorySchema).min(1).safeParse(JSON.parse(company.pestCategoryConfig));
    return parsed.success ? parsed.data : DEFAULT_PEST_CATEGORIES;
  } catch {
    return DEFAULT_PEST_CATEGORIES;
  }
}

export function parseServiceArrangements(company: { serviceArrangements?: string | null }): ServiceArrangement[] {
  if (!company.serviceArrangements) return [...SERVICE_ARRANGEMENTS];
  try {
    const parsed = z.array(z.enum(SERVICE_ARRANGEMENTS)).min(1).safeParse(JSON.parse(company.serviceArrangements));
    return parsed.success ? parsed.data : [...SERVICE_ARRANGEMENTS];
  } catch {
    return [...SERVICE_ARRANGEMENTS];
  }
}

export function pestCategoryForConcern(categories: PestCategory[], concern: string | null | undefined): PestCategory | null {
  if (!concern) return null;
  return categories.find((category) => category.id === concern || category.pestTypes.includes(concern)) ?? null;
}

export function formatPotentialValueRange(category: PestCategory): string | null {
  const { potentialValueMinCents: min, potentialValueMaxCents: max, potentialValueOpenEnded } = category;
  if (min === null || max === null) return null;
  const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;
  return `${dollars(min)}–${dollars(max)}${potentialValueOpenEnded ? "+" : ""}`;
}

export function serviceArrangementLabel(value: string | null | undefined): string {
  if (value === "ONE_TIME") return "One-time service";
  if (value === "QUARTERLY") return "Quarterly service";
  if (value === "BIMONTHLY") return "Bi-monthly service";
  return "—";
}
