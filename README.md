# Kim İçeride?

Türkiye'de tanınmış kişilerin (iş, sanat, spor, siyaset, medya, hukuk, akademi,
sivil toplum) gözaltı, tutuklama ve dava süreçlerini **kaynaklı ve güncel**
biçimde takip eden statik site.

- Her kişi için tam zaman çizelgesi: gözaltı → tutuklama → iddianame → duruşmalar → tahliye/hüküm
- Her olay en az bir haber kaynağına bağlı (teknik olarak zorunlu)
- Her gün AI destekli haber taraması + **insan onayı** (PR review) ile güncellenir
- Veriler Git'te JSON olarak tutulur; tüm değişiklik geçmişi şeffaf
- Açık veri: `/api/people.json` + RSS feed

## Mimari

```
data/people/*.json  ─┐
data/cases/*.json   ─┼─▶ Astro statik site ──▶ Cloudflare Pages (+ mirror)
                     │
GitHub Actions (günlük cron)
  └─ scripts/scan.ts: Google News RSS → Claude API → öneriler → PR
       └─ İnsan PR'ı inceler → merge → otomatik deploy
```

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Geliştirme sunucusu (`localhost:4321`) |
| `npm run build` | Statik site üretir (`dist/`) |
| `npm run validate` | Veri şeması + tutarlılık denetimi (CI'da zorunlu) |
| `npm run scan:dry` | Haber taramasını dener; veriye dokunmaz, önerileri `drafts/` altına yazar |
| `npm run scan` | Önerileri `data/`'ya uygular (normalde yalnızca CI çalıştırır) |

`scan` komutları `ANTHROPIC_API_KEY` ortam değişkenine ihtiyaç duyar.

## Veri modeli

`data/people/<slug>.json` — kişi başına bir dosya. Şema [src/lib/schema.ts](src/lib/schema.ts)
içinde Zod ile tanımlı; kaynaksız olay kaydı şemadan geçmez. `data/cases/<slug>.json`
dava/operasyon gruplarını tanımlar.

Elle veri eklerken: dosyayı oluşturun → `npm run validate` → `npm run build`.

## Günlük iş akışı (yayın sonrası)

1. GitHub Actions her sabah 06:00'da (TR) haberleri tarar ve bir PR açar
2. Telefondan/bilgisayardan PR'a bakın: her önerinin kaynağını kontrol edin
3. Yanlış öneri varsa PR'da düzeltin ya da çıkarın, sonra merge edin
4. Merge → site otomatik build olur ve yayınlanır (~5-10 dk/gün)

Düşük güvenli öneriler veriye uygulanmaz; PR gövdesinde "şüpheli" olarak listelenir.

## Yayına alma

1. GitHub'da repo oluşturun ve push edin (şeffaflık + fork edilebilirlik için public önerilir).
   **Not:** Public repo GitHub hesabınızla bağlantılı olur; istenirse ayrı bir hesap/organizasyon kullanın.
2. Repo ayarlarında secret ekleyin: `ANTHROPIC_API_KEY`
3. [Cloudflare Pages](https://pages.cloudflare.com)'te repoyu bağlayın:
   build komutu `npm run build`, çıktı dizini `dist`
4. (Önerilir) GitHub Pages'i mirror olarak açın; `astro.config.mjs` içindeki `site`
   değerini gerçek domain ile güncelleyin
5. İlk taramayı elle tetikleyin: Actions → "Günlük tarama" → Run workflow

## Hukuki/etik çerçeve

- Yalnızca kamuya mal olmuş kişiler + basında yayımlanmış bilgiler; her iddia kaynaklı
- Masumiyet karinesi notu her sayfada; dil nötr (yorum yok, olgu var)
- Tahliye/beraat kararları da tutuklamalarla aynı titizlikle işlenir
- Düzeltme talepleri için iletişim kanalı açık tutulmalı
- **Yayın öncesi KVKK/basın hukuku konusunda bir hukukçuya danışılması önerilir**
