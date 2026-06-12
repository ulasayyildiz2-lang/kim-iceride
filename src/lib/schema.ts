import { z } from "zod";

// ---- Sabitler ------------------------------------------------------------

export const CATEGORY_META = {
  is: { label: "İş dünyası" },
  sanat: { label: "Sanat" },
  spor: { label: "Spor" },
  siyaset: { label: "Siyaset" },
  medya: { label: "Medya" },
  hukuk: { label: "Hukuk" },
  akademi: { label: "Akademi" },
  stk: { label: "Sivil toplum" },
} as const;

export const STATUS_META = {
  gozaltinda: {
    label: "Gözaltında",
    badge: "bg-amber-100 text-amber-800 border-amber-300",
    dot: "bg-amber-500",
  },
  tutuklu: {
    label: "Tutuklu",
    badge: "bg-red-100 text-red-800 border-red-300",
    dot: "bg-red-600",
  },
  "adli-kontrol": {
    label: "Adli kontrol",
    badge: "bg-orange-100 text-orange-800 border-orange-300",
    dot: "bg-orange-500",
  },
  "tutuksuz-yargilaniyor": {
    label: "Tutuksuz yargılanıyor",
    badge: "bg-yellow-100 text-yellow-800 border-yellow-300",
    dot: "bg-yellow-500",
  },
  tahliye: {
    label: "Tahliye edildi",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-300",
    dot: "bg-emerald-500",
  },
  hukumlu: {
    label: "Hükümlü",
    badge: "bg-rose-100 text-rose-900 border-rose-300",
    dot: "bg-rose-700",
  },
  beraat: {
    label: "Beraat etti",
    badge: "bg-green-100 text-green-800 border-green-300",
    dot: "bg-green-600",
  },
  serbest: {
    label: "Serbest",
    badge: "bg-stone-100 text-stone-700 border-stone-300",
    dot: "bg-stone-400",
  },
} as const;

export const EVENT_META = {
  gozalti: { label: "Gözaltı", dot: "bg-amber-500" },
  tutuklama: { label: "Tutuklama", dot: "bg-red-600" },
  iddianame: { label: "İddianame", dot: "bg-sky-600" },
  durusma: { label: "Duruşma", dot: "bg-indigo-500" },
  tahliye: { label: "Tahliye", dot: "bg-emerald-500" },
  mahkumiyet: { label: "Mahkûmiyet", dot: "bg-rose-700" },
  beraat: { label: "Beraat", dot: "bg-green-600" },
  "adli-kontrol": { label: "Adli kontrol", dot: "bg-orange-500" },
  serbest: { label: "Serbest bırakılma", dot: "bg-stone-400" },
  diger: { label: "Gelişme", dot: "bg-stone-500" },
} as const;

export type Category = keyof typeof CATEGORY_META;
export type Status = keyof typeof STATUS_META;
export type EventType = keyof typeof EVENT_META;

const CATEGORIES = Object.keys(CATEGORY_META) as [Category, ...Category[]];
const STATUSES = Object.keys(STATUS_META) as [Status, ...Status[]];
const EVENT_TYPES = Object.keys(EVENT_META) as [EventType, ...EventType[]];

// ---- Şemalar ---------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD biçiminde olmalı");

export const SourceSchema = z.object({
  url: z.url("Geçerli bir URL olmalı"),
  outlet: z.string().min(1, "Kaynak adı boş olamaz"),
  date: isoDate.optional(),
});

export const EventSchema = z.object({
  date: isoDate,
  type: z.enum(EVENT_TYPES),
  description: z.string().min(5, "Açıklama çok kısa"),
  sources: z.array(SourceSchema).min(1, "Her olay için en az 1 kaynak zorunlu"),
});

export const PersonSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id küçük harf slug olmalı"),
  name: z.string().min(2),
  category: z.enum(CATEGORIES),
  currentStatus: z.enum(STATUSES),
  case: z.string().regex(/^[a-z0-9-]+$/).nullable().optional(),
  summary: z.string().min(10, "Özet çok kısa"),
  events: z.array(EventSchema).min(1, "En az 1 olay zorunlu"),
  lastUpdated: isoDate,
});

export const CaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2),
  description: z.string().min(10),
});

export type Source = z.infer<typeof SourceSchema>;
export type PersonEvent = z.infer<typeof EventSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type Case = z.infer<typeof CaseSchema>;

// ---- Durum türetme ---------------------------------------------------------

// İddianame/duruşma gibi olaylar kişinin özgürlük durumunu değiştirmez;
// null dönen tipler bir önceki durumu korur.
const STATUS_EFFECT: Record<EventType, Status | null> = {
  gozalti: "gozaltinda",
  tutuklama: "tutuklu",
  tahliye: "tahliye",
  mahkumiyet: "hukumlu",
  beraat: "beraat",
  "adli-kontrol": "adli-kontrol",
  serbest: "serbest",
  iddianame: null,
  durusma: null,
  diger: null,
};

export function deriveStatus(events: PersonEvent[]): Status | null {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let status: Status | null = null;
  for (const e of sorted) {
    const effect = STATUS_EFFECT[e.type];
    if (effect) status = effect;
  }
  return status;
}
