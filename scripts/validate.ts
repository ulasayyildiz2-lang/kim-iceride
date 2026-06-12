/**
 * Veri doğrulama: data/ altındaki tüm kayıtları şema ve tutarlılık
 * açısından denetler. Hata varsa exit 1 döner (CI bunu zorunlu kılar).
 *
 * Kullanım: npm run validate
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import {
  PersonSchema,
  CaseSchema,
  deriveStatus,
  type Person,
  type Status,
} from "../src/lib/schema";

const DATA_DIR = join(process.cwd(), "data");
const PEOPLE_DIR = join(DATA_DIR, "people");
const CASES_DIR = join(DATA_DIR, "cases");

const errors: string[] = [];
const warnings: string[] = [];

function readJsonFiles(dir: string): Array<{ file: string; json: unknown }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const path = join(dir, f);
      try {
        return { file: f, json: JSON.parse(readFileSync(path, "utf-8")) };
      } catch (e) {
        errors.push(`${f}: JSON ayrıştırılamadı — ${(e as Error).message}`);
        return { file: f, json: null };
      }
    })
    .filter((x) => x.json !== null);
}

// ---- Davalar ---------------------------------------------------------------

const caseIds = new Set<string>();
for (const { file, json } of readJsonFiles(CASES_DIR)) {
  const result = CaseSchema.safeParse(json);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`cases/${file}: ${issue.path.join(".")} — ${issue.message}`);
    }
    continue;
  }
  if (`${result.data.id}.json` !== file) {
    errors.push(`cases/${file}: id "${result.data.id}" dosya adıyla uyuşmuyor`);
  }
  caseIds.add(result.data.id);
}

// ---- Kişiler ---------------------------------------------------------------

// Tutukluluk açısından "içeride" sayılan durumlar; türetilen durumla beyan
// edilen durum farklı gruplardaysa veri çelişkili demektir.
const IN_CUSTODY: ReadonlySet<Status> = new Set([
  "gozaltinda",
  "tutuklu",
  "hukumlu",
]);

const today = new Date().toISOString().slice(0, 10);
const usedCaseIds = new Set<string>();
const people: Person[] = [];

for (const { file, json } of readJsonFiles(PEOPLE_DIR)) {
  const result = PersonSchema.safeParse(json);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`people/${file}: ${issue.path.join(".")} — ${issue.message}`);
    }
    continue;
  }
  const p = result.data;
  people.push(p);

  if (`${p.id}.json` !== file) {
    errors.push(`people/${file}: id "${p.id}" dosya adıyla uyuşmuyor`);
  }

  // Olaylar kronolojik sıralı olmalı
  for (let i = 1; i < p.events.length; i++) {
    if (p.events[i].date < p.events[i - 1].date) {
      errors.push(
        `people/${file}: olaylar kronolojik değil (${p.events[i].date} < ${p.events[i - 1].date})`,
      );
      break;
    }
  }

  // Gelecek tarihli kayıt olmamalı
  for (const e of p.events) {
    if (e.date > today) {
      warnings.push(`people/${file}: gelecek tarihli olay (${e.date})`);
    }
  }

  // Dava referansı geçerli olmalı
  if (p.case) {
    if (!caseIds.has(p.case)) {
      errors.push(`people/${file}: bilinmeyen dava referansı "${p.case}"`);
    } else {
      usedCaseIds.add(p.case);
    }
  }

  // Beyan edilen durum, olaylardan türetilen durumla çelişmemeli
  const derived = deriveStatus(p.events);
  if (derived && IN_CUSTODY.has(derived) !== IN_CUSTODY.has(p.currentStatus)) {
    errors.push(
      `people/${file}: currentStatus "${p.currentStatus}" ile olaylardan türetilen durum "${derived}" çelişiyor`,
    );
  } else if (derived && derived !== p.currentStatus) {
    warnings.push(
      `people/${file}: currentStatus "${p.currentStatus}", türetilen durum "${derived}" (aynı grup, bilgi amaçlı)`,
    );
  }
}

// Kullanılmayan dava dosyaları
for (const id of caseIds) {
  if (!usedCaseIds.has(id)) {
    warnings.push(`cases/${id}.json: hiçbir kişi bu davaya bağlı değil`);
  }
}

// ---- Rapor -----------------------------------------------------------------

console.log(`\n${people.length} kişi, ${caseIds.size} dava denetlendi.\n`);

if (warnings.length) {
  console.log("Uyarılar:");
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  console.log();
}

if (errors.length) {
  console.error("Hatalar:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\nDoğrulama BAŞARISIZ (${errors.length} hata).`);
  process.exit(1);
}

console.log("Doğrulama başarılı ✓");
