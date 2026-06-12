import type { APIRoute } from "astro";
import { people, cases } from "../../lib/data";

export const GET: APIRoute = () => {
  const lastUpdated = people
    .map((p) => p.lastUpdated)
    .sort()
    .at(-1);

  const body = {
    site: "Kim İçeride?",
    license:
      "Veriler kamuya açık haber kaynaklarından derlenmiştir; kaynak gösterilerek serbestçe kullanılabilir.",
    lastUpdated,
    counts: { people: people.length, cases: cases.length },
    cases,
    people,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
