import {
  PersonSchema,
  CaseSchema,
  type Person,
  type Case,
  type PersonEvent,
} from "./schema";

const peopleModules = import.meta.glob<{ default: unknown }>(
  "../../data/people/*.json",
  { eager: true },
);
const caseModules = import.meta.glob<{ default: unknown }>(
  "../../data/cases/*.json",
  { eager: true },
);

export const people: Person[] = Object.values(peopleModules)
  .map((m) => PersonSchema.parse(m.default))
  .sort((a, b) => a.name.localeCompare(b.name, "tr"));

export const cases: Case[] = Object.values(caseModules)
  .map((m) => CaseSchema.parse(m.default))
  .sort((a, b) => a.name.localeCompare(b.name, "tr"));

export function getCase(id: string | null | undefined): Case | undefined {
  return id ? cases.find((c) => c.id === id) : undefined;
}

export function peopleInCase(caseId: string): Person[] {
  return people.filter((p) => p.case === caseId);
}

/** Olayları eskiden yeniye sıralar. */
export function sortedEvents(p: Person): PersonEvent[] {
  return [...p.events].sort((a, b) => a.date.localeCompare(b.date));
}

export function lastEvent(p: Person): PersonEvent {
  return sortedEvents(p)[p.events.length - 1];
}

export interface FeedItem {
  person: Person;
  event: PersonEvent;
}

/** Tüm kişilerin olaylarını yeniden eskiye akış halinde döndürür. */
export function eventFeed(limit?: number): FeedItem[] {
  const items: FeedItem[] = people.flatMap((person) =>
    person.events.map((event) => ({ person, event })),
  );
  items.sort((a, b) => b.event.date.localeCompare(a.event.date));
  return limit ? items.slice(0, limit) : items;
}

export function personUrl(p: Person): string {
  return `/kisi/${p.id}/`;
}

export function caseUrl(c: Case): string {
  return `/dava/${c.id}/`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr");
}
