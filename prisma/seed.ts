/**
 * Seeds exactly one real, usable Company + owner login + inspector so the
 * app is operable end-to-end in dev. This is operational scaffolding
 * (account you actually log into), not fabricated demo data — no leads,
 * appointments, or analytics are seeded; those only appear from real usage.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_SCORING_RULES } from "../src/lib/scoring";
import { DEFAULT_BUSINESS_HOURS } from "../src/lib/scheduling";
import { resolveSeedOwnerConfig } from "../src/lib/seed-config";

const prisma = new PrismaClient();

async function main() {
  const { email: ownerEmail, password: ownerPassword } = resolveSeedOwnerConfig();

  const company = await prisma.company.upsert({
    where: { slug: "demo-pest-control" },
    update: {},
    create: {
      name: "Demo Pest Control Co.",
      slug: "demo-pest-control",
      timezone: "America/Chicago",
      serviceZipCodes: JSON.stringify(["73301", "78701", "78702", "78703"]),
      supportedPests: JSON.stringify([
        "ants",
        "roaches",
        "termites",
        "rodents",
        "bed_bugs",
        "spiders",
        "wasps",
      ]),
      businessHours: JSON.stringify(DEFAULT_BUSINESS_HOURS),
      inspectionDurationMinutes: 60,
      maxDailyInspections: 8,
      scoringRules: JSON.stringify(DEFAULT_SCORING_RULES),
      mqlThreshold: 40,
      sqlThreshold: 70,
    },
  });

  const passwordHash = await bcrypt.hash(ownerPassword, 10);
  await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      companyId: company.id,
      name: "Owner",
      email: ownerEmail,
      passwordHash,
      role: "owner",
    },
  });

  await prisma.inspector.upsert({
    where: { id: `${company.id}-default-inspector` },
    update: {},
    create: {
      id: `${company.id}-default-inspector`,
      companyId: company.id,
      name: "Default Inspector",
      email: "inspector@example.com",
      active: true,
    },
  });

  console.log(`Seeded company "${company.name}" (${company.slug}).`);
  console.log(`Owner account ensured for ${ownerEmail}; password was not changed if it already existed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
