import type { APIRoute } from "astro";
import { eventFeed, personUrl, formatDate } from "../lib/data";
import { EVENT_META } from "../lib/schema";

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() ?? "https://kim-iceride.pages.dev").replace(
    /\/$/,
    "",
  );

  const items = eventFeed(50)
    .map(({ person, event }) => {
      const title = `${person.name} — ${EVENT_META[event.type].label} (${formatDate(event.date)})`;
      const link = `${base}${personUrl(person)}`;
      const pubDate = new Date(`${event.date}T06:00:00+03:00`).toUTCString();
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(`${person.id}-${event.date}-${event.type}`)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(event.description)}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Kim İçeride?</title>
    <link>${escapeXml(base)}</link>
    <description>Türkiye'de gözaltı, tutuklama ve dava süreçleri — kaynaklı ve güncel takip</description>
    <language>tr</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
};
