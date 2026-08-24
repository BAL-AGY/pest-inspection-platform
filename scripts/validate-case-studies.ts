// Validates every JSON file under docs/marketing-intelligence/case-studies/
// against the same Zod schema the app uses at read time. Run via
// `npm run validate:case-studies`. Exits non-zero if any file is invalid.
import { loadCaseStudies } from "../src/lib/marketing-intelligence/case-studies";

const { studies, errors } = loadCaseStudies();

console.log(`Checked docs/marketing-intelligence/case-studies/ — ${studies.length} valid, ${errors.length} invalid.\n`);

for (const study of studies) {
  console.log(`  ✓ ${study.id} (${study.evidenceQuality} evidence)`);
}

if (errors.length > 0) {
  console.log("");
  for (const error of errors) {
    console.log(`  ✗ ${error.file}`);
    for (const issue of error.issues) console.log(`      ${issue}`);
  }
  console.log(`\n${errors.length} file(s) failed validation.`);
  process.exit(1);
}

console.log("\nAll case studies valid.");
