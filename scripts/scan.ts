/**
 * Günlük haber taraması:
 *  1. Google News RSS'ten anahtar kelime + isim bazlı sorgularla son haberleri çeker
 *  2. Mevcut veri özetiyle birlikte Claude API'ye gönderir, yapılandırılmış
 *     güncelleme önerileri alır (her öneri kaynak URL'siyle)
 *  3. Önerileri data/ dosyalarına uygular ve PR gövdesi (drafts/pr-body.md) üretir
 *
 * Kullanım:
 *   npm run scan:dry   — veriye dokunmaz; önerileri drafts/ altına yazar ve özetler
 *   npm run scan       — önerileri data/'ya uygular (CI bunu PR branch'inde çalıştırır)
 *
 * Gereken ortam değişkeni: ANTHROPIC_API_KEY
 *
 * Guardrail'ler:
 *  - Model yalnızca kendisine verilen haber linklerini kaynak gösterebilir
 *  - Kaynaksız öneri uygulanmaz (Zod şeması zaten reddeder)
 *  - "dusuk" güvenli öneriler uygulanmaz, yalnızca PR gövdesinde "şüpheli" listelenir
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Parser from "rss-parser";
import Anthropic from "@anthropic-ai/sdk";
import {
  PersonSchema,
  CATEGORY_META,
  STATUS_META,
  EVENT_META,
  type Person,
} from "../src/lib/schema";

const DRY_RUN = process.argv.includes("--dry-run");
const DATA_DIR = join(process.cwd(), "data");
const PEOPLE_DIR = join(DATA_DIR, "people");
const DRAFTS_DIR = join(process.cwd(), "drafts");

const TODAY = new Date().toISOString().slice(0, 10);

// ---- 1. Mevcut veriyi yükle -------------------------------------------------

const people: Person[] = readdirSync(PEOPLE_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => PersonSchema.parse(JSON.parse(readFileSync(join(PEOPLE_DIR, f), "utf-8"))));

const dataSummary = people
  .map((p) => {
    const last = [...p.events].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
    return `- ${p.name} (id: ${p.id}, kategori: ${p.category}, durum: ${p.currentStatus}, son olay: ${last.type} ${last.date})`;
  })
  .join("\n");

// ---- 2. RSS taraması --------------------------------------------------------

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  query: string;
}

const KEYWORD_QUERIES = [
  '"gözaltına alındı"',
  '"tutuklandı"',
  '"tahliye edildi"',
  '"iddianame kabul edildi"',
  '"beraat etti"',
];

function googleNewsUrl(query: string): string {
  const q = encodeURIComponent(`${query} when:2d`);
  return `https://news.google.com/rss/search?q=${q}&hl=tr&gl=TR&ceid=TR:tr`;
}

async function fetchNews(): Promise<NewsItem[]> {
  const parser = new Parser({ timeout: 15000 });
  const queries = [
    ...KEYWORD_QUERIES,
    ...people.map((p) => `"${p.name}"`),
  ];

  const items: NewsItem[] = [];
  for (const query of queries) {
    try {
      const feed = await parser.parseURL(googleNewsUrl(query));
      for (const item of feed.items.slice(0, 10)) {
        if (!item.title || !item.link) continue;
        items.push({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate ?? "",
          query,
        });
      }
    } catch (e) {
      console.warn(`RSS sorgusu başarısız (${query}): ${(e as Error).message}`);
    }
  }

  // Başlığa göre tekilleştir
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.title.toLocaleLowerCase("tr");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- 3. Claude ile yapılandırma ---------------------------------------------

const CONFIDENCE_LEVELS = ["yuksek", "orta", "dusuk"] as const;

interface Proposal {
  personId: string;
  isNew: boolean;
  name: string;
  category: keyof typeof CATEGORY_META;
  eventType: keyof typeof EVENT_META;
  date: string;
  description: string;
  newStatus: keyof typeof STATUS_META;
  summary: string;
  confidence: (typeof CONFIDENCE_LEVELS)[number];
  sources: Array<{ url: string; outlet: string }>;
}

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          personId: {
            type: "string",
            description: "Mevcut kişiyse mevcut id, yeni kişiyse küçük harf slug",
          },
          isNew: { type: "boolean" },
          name: { type: "string" },
          category: { type: "string", enum: Object.keys(CATEGORY_META) },
          eventType: { type: "string", enum: Object.keys(EVENT_META) },
          date: { type: "string", format: "date" },
          description: {
            type: "string",
            description: "Nötr, olgusal, tek cümlelik Türkçe açıklama",
          },
          newStatus: { type: "string", enum: Object.keys(STATUS_META) },
          summary: {
            type: "string",
            description: "Yeni kişi için 1-2 cümlelik nötr özet; mevcut kişi için güncel özet",
          },
          confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: { type: "string" },
                outlet: { type: "string" },
              },
              required: ["url", "outlet"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "personId", "isNew", "name", "category", "eventType", "date",
          "description", "newStatus", "summary", "confidence", "sources",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["proposals"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `Türkiye'de tanınmış kişilerin (iş, sanat, spor, siyaset, medya, hukuk, akademi, sivil toplum) gözaltı/tutuklama/dava süreçlerini takip eden bir veri tabanının günlük güncelleme asistanısın.

Sana (1) takip edilen kişilerin güncel durumu, (2) bugünkü haber başlıkları verilecek. Görevin: veri tabanına eklenmesi gereken SOMUT adli süreç gelişmelerini yapılandırılmış öneri listesi olarak çıkarmak.

KURALLAR:
1. Yalnızca verilen haber başlıklarından SOMUT olarak anlaşılan gelişmeleri öner. Tahmin, çıkarım, spekülasyon yapma.
2. Kaynak olarak YALNIZCA sana verilen haber linklerini kullan. Başka URL üretme.
3. Takip edilen kişiler için: durum değişikliği (tutuklama, tahliye, duruşma, karar vb.) varsa öner. Zaten kayıtlı görünen eski gelişmeleri tekrar önerme (kişinin son olay tarihinden eski gelişmeleri atla).
4. Yeni kişi yalnızca şu koşullarda öner: kamuoyunun tanıdığı bir isim + somut bir adli işlem (gözaltı/tutuklama/iddianame). Sıradan vatandaşları veya belirsiz vakaları ekleme.
5. Açıklamalar nötr ve olgusal: "iddiasıyla", "kapsamında" gibi ifadeler kullan; suçlayıcı/savunucu dil yok.
6. confidence: "yuksek" = başlık gelişmeyi açıkça söylüyor; "orta" = büyük olasılıkla doğru ama başlık belirsiz; "dusuk" = emin değilsin.
7. Emin olmadığın tarihler için haberin yayın tarihini kullan ve confidence'ı düşür.
8. Hiç uygun gelişme yoksa boş liste döndür.`;

async function extractProposals(news: NewsItem[]): Promise<Proposal[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY tanımlı değil.");
    process.exit(1);
  }
  const client = new Anthropic();

  const newsBlock = news
    .map((n, i) => `${i + 1}. [${n.pubDate}] ${n.title}\n   Link: ${n.link}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: PROPOSAL_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Bugünün tarihi: ${TODAY}

## Takip edilen kişiler (güncel durum)
${dataSummary}

## Bugünkü haber başlıkları
${newsBlock}

Veri tabanına eklenmesi gereken gelişmeleri öner.`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return [];
  return (JSON.parse(text.text) as { proposals: Proposal[] }).proposals;
}

// ---- 4. Önerileri uygula ----------------------------------------------------

function applyProposal(p: Proposal): string {
  const event = {
    date: p.date,
    type: p.eventType,
    description: p.description,
    sources: p.sources.map((s) => ({ ...s, date: TODAY })),
  };

  if (p.isNew) {
    const person: Person = PersonSchema.parse({
      id: p.personId,
      name: p.name,
      category: p.category,
      currentStatus: p.newStatus,
      case: null,
      summary: p.summary,
      events: [event],
      lastUpdated: TODAY,
    });
    writeFileSync(
      join(PEOPLE_DIR, `${p.personId}.json`),
      JSON.stringify(person, null, 2) + "\n",
      "utf-8",
    );
    return `yeni kişi eklendi: ${p.name}`;
  }

  const path = join(PEOPLE_DIR, `${p.personId}.json`);
  const person = PersonSchema.parse(JSON.parse(readFileSync(path, "utf-8")));

  const duplicate = person.events.some(
    (e) => e.date === event.date && e.type === event.type,
  );
  if (duplicate) return `atlandı (zaten kayıtlı): ${p.name} ${p.eventType} ${p.date}`;

  person.events.push(event);
  person.events.sort((a, b) => a.date.localeCompare(b.date));
  person.currentStatus = p.newStatus;
  person.lastUpdated = TODAY;

  writeFileSync(path, JSON.stringify(PersonSchema.parse(person), null, 2) + "\n", "utf-8");
  return `olay eklendi: ${p.name} → ${p.eventType} (${p.date})`;
}

// ---- 5. PR gövdesi ----------------------------------------------------------

function buildPrBody(proposals: Proposal[], applied: string[], lowConfidence: Proposal[]): string {
  const lines = [
    `# Günlük tarama — ${TODAY}`,
    "",
    "Aşağıdaki güncellemeler haber taramasından otomatik üretildi. **Merge etmeden önce her satırdaki kaynağı kontrol edin.**",
    "",
    "| Kişi | Olay | Tarih | Güven | Kaynak |",
    "|---|---|---|---|---|",
  ];
  for (const p of proposals.filter((x) => x.confidence !== "dusuk")) {
    const src = p.sources.map((s) => `[${s.outlet}](${s.url})`).join(", ");
    lines.push(`| ${p.name}${p.isNew ? " **(YENİ)**" : ""} | ${EVENT_META[p.eventType].label} | ${p.date} | ${p.confidence} | ${src} |`);
  }
  if (lowConfidence.length) {
    lines.push("", "## ⚠️ Düşük güvenli öneriler (uygulanmadı, elle kontrol edin)", "");
    for (const p of lowConfidence) {
      const src = p.sources.map((s) => `[${s.outlet}](${s.url})`).join(", ");
      lines.push(`- ${p.name}: ${p.description} (${src})`);
    }
  }
  lines.push("", "## Uygulanan değişiklikler", "");
  for (const a of applied) lines.push(`- ${a}`);
  return lines.join("\n");
}

// ---- main --------------------------------------------------------------------

async function main() {
  console.log(`Tarama başlıyor (${DRY_RUN ? "dry-run" : "apply"} modu), ${people.length} kişi takipte.`);

  const news = await fetchNews();
  console.log(`${news.length} benzersiz haber başlığı toplandı.`);
  mkdirSync(DRAFTS_DIR, { recursive: true });

  if (news.length === 0) {
    console.log("Haber bulunamadı; çıkılıyor.");
    return;
  }

  const proposals = await extractProposals(news);
  console.log(`${proposals.length} öneri üretildi.`);

  writeFileSync(
    join(DRAFTS_DIR, `${TODAY}-proposals.json`),
    JSON.stringify(proposals, null, 2),
    "utf-8",
  );

  const lowConfidence = proposals.filter((p) => p.confidence === "dusuk");
  const applicable = proposals.filter((p) => p.confidence !== "dusuk");

  const applied: string[] = [];
  if (!DRY_RUN) {
    for (const p of applicable) {
      try {
        applied.push(applyProposal(p));
      } catch (e) {
        console.error(`Öneri uygulanamadı (${p.name}): ${(e as Error).message}`);
      }
    }
  } else {
    for (const p of applicable) {
      applied.push(`[dry-run] ${p.name} → ${p.eventType} (${p.date})`);
    }
  }

  const prBody = buildPrBody(proposals, applied, lowConfidence);
  writeFileSync(join(DRAFTS_DIR, "pr-body.md"), prBody, "utf-8");

  console.log("\n" + prBody);
  console.log(`\nTaslaklar drafts/ altına yazıldı.${DRY_RUN ? " (dry-run: data/ değişmedi)" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
