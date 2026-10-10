# Katalog stackow — kazda warstwa po kolei (generowany)

Zrodlo prawdy: `stack-data.json` (ten katalog). Stan: 2026-10-10. Skrot orientacyjny, nie cennik ani benchmark. „usual" = podpowiedz floty (owner-stack.md), nie decyzja.
Proces: przy nowym projekcie KAZDA kategoria nizej dostaje wiersz `stack-<id>` w `docs/architecture/obszary.md` (DECYZJA / NIE TERAZ / NIE DOTYCZY; pg/design.md G).
Nic nie jest wybrane z gory; wybor spoza „zwykle u nas" = krotki ADR (`pg/design.md` E). Rynek (PL/UE/Islandia/globalnie) wybiera narzedzia lokalne.

## Klient

### Frontend (`stack-fe`)

Pytanie: Czym rysujemy interfejs i czy liczy się SEO? Zwykle u nas: Next.js, React, TanStack Start. PG: `F.1` boring stack; Lovable tylko przy lovable-tagger.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Next.js | globalnie | React z renderowaniem na serwerze, routingiem i API w jednym. | SEO + dynamiczne strony, sklep, Payload. |
| React | globalnie | Biblioteka UI; u nas zwykle jako SPA na Vite. | Panel/aplikacja za logowaniem, gdzie SEO nie gra roli. |
| TanStack Start | globalnie | Full-stack React na typowanym TanStack Router. | SSR i typowany routing bez Next.js (tak działa kamiljan.com). |
| Vue | globalnie | Framework UI o łagodnej krzywej nauki, alternatywa dla React. | Klient albo jego zespół już pracuje w Vue. |
| Svelte | globalnie | Kompilowany framework, mało JS w paczce. | Lekkie, bardzo szybkie widgety; słabe telefony użytkowników. |
| Astro | globalnie | Strony treściowe, domyślnie zero JS, interaktywne „wyspy”. | Blog, landing, dokumentacja: najszybsza strona z treścią. |
| SolidJS | globalnie | Reaktywność bez wirtualnego DOM, składnia jak JSX. | Rzadko; gdy liczy się ekstremalna wydajność UI. |
| Angular | globalnie | Pełny framework Google z TypeScript i DI. | Klient korporacyjny ze standardem Angular. |
| Remix | globalnie | React oparty na formularzach i loaderach; dziś rozwijany jako React Router 7. | Aplikacje mocno formularzowe, progressive enhancement. |
| Nuxt | globalnie | Odpowiednik Next.js dla Vue. | Vue + SSR/SEO. |
| Blazor | globalnie | UI pisane w C# (.NET), bez JavaScriptu. | Klient z zespołem .NET, który przejmie kod. |

### Styling / UI (`stack-ui`)

Pytanie: Skąd komponenty i tokeny designu? Zwykle u nas: Tailwind CSS. PG: Design system = tokeny; skill `design-styles`.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Tailwind CSS | globalnie | Klasy użytkowe CSS pisane w markupie. | Domyślnie we flocie (Tailwind 4). |
| shadcn/ui | globalnie | Komponenty kopiowane do repo (Radix + Tailwind), nie zależność. | Szybki własny design system; częste w kodzie z Lovable. |
| Radix UI | globalnie | Dostępne prymitywy bez stylu (dialog, menu, tabs). | Własne komponenty z porządnym a11y. |
| Chakra UI | globalnie | Gotowe komponenty stylowane propsami. | Szybki panel bez Tailwinda. |
| Mantine | globalnie | Duża biblioteka komponentów + hooki (daty, formularze, tabele). | Panel admina z dużą ilością formularzy i tabel. |
| MUI | globalnie | Komponenty Material Design (Google), DataGrid. | Klient chce wygląd Material albo gotową zaawansowaną tabelę. |
| Bootstrap | globalnie | Klasyczny framework CSS z komponentami. | Stare projekty i gotowe szablony. |

### Aplikacja mobilna (`stack-mobile`)

Pytanie: Czy użytkownik potrzebuje aplikacji ze sklepu, czy wystarczy strona? Zwykle u nas: PWA. PG: Karta `sd/04`: offline, push, wersjonowanie API pod stare aplikacje.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| PWA | globalnie | Strona instalowana na ekranie, push i offline w przeglądarce. | Najpierw to: zero sklepów, jeden kod z webem. |
| React Native (Expo) | globalnie | Natywna aplikacja w React/TS, wspólna logika z webem. | Potrzebny sklep, aparat, tło, płynny natywny UI. |
| Flutter | globalnie | Aplikacja w Dart z własnym silnikiem rysowania. | Zespół klienta zna Flutter; identyczny UI na iOS i Android. |
| Capacitor | globalnie | Opakowanie aplikacji web w natywną skorupę. | Istniejąca aplikacja web ma trafić do sklepu małym kosztem. |
| Swift / Kotlin | globalnie | Osobne natywne aplikacje. | Wymagające funkcje sprzętowe albo zespół natywny klienta. |

## Serwer

### Runtime (`stack-rt`)

Pytanie: W czym działa logika serwera? Zwykle u nas: Node.js, Deno. PG: Edge Functions nie deployują się z gita (`prr.md`).

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Node.js | globalnie | Standardowy runtime JavaScript/TypeScript na serwerze. | Domyślnie (Next, Payload, skrypty). |
| Bun | globalnie | Szybki runtime + bundler + test runner, zgodny z Node. | Szybsze skrypty i testy; nowe narzędzia CLI. |
| Deno | globalnie | Runtime TS z uprawnieniami; na nim działają Supabase Edge Functions. | Webhooki, płatności, integracje w Supabase. |
| Python (FastAPI) | globalnie | API w Pythonie z typami przez Pydantic. | ML/AI, OCR, pandas: biblioteki, które są tylko w Pythonie. |
| Go | globalnie | Kompilowany, mało pamięci, prosta współbieżność. | Wydajny worker/serwis, CLI, tysiące połączeń. |
| Ruby on Rails | globalnie | Full-stack Ruby z mocnymi konwencjami. | Przejmujesz kod klienta w Rails. |
| Elixir / Phoenix | globalnie | Maszyna BEAM: ogromna liczba równoległych połączeń, LiveView. | Realtime na dużą skalę (czaty, powiadomienia na żywo). |
| NestJS | globalnie | Backend Node z modułami i DI (styl Angulara). | Duży backend Node z kilkoma programistami. |
| Hono | globalnie | Mały framework HTTP na edge (Workers, Deno, Bun). | API na Cloudflare Workers albo w Edge Functions. |
| ASP.NET Core (.NET) | globalnie | Backend w C#/.NET. | Ekosystem Microsoft u klienta. |
| Spring Boot | globalnie | Backend w Javie (JVM). | Bank/korporacja ze standardem Java. |

### Compute / Hosting (`stack-host`) — trudno cofnac (drzwi jednokierunkowe pilnuja obszary SD)

Pytanie: Gdzie działa kod i w jakim regionie leżą dane? Zwykle u nas: Vercel. PG: Region i DR = drzwi jednokierunkowe (`sd-areas: koszt-region`).

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Vercel | globalnie | Hosting frontu i funkcji, preview per PR. | Domyślnie. |
| AWS EC2 | globalnie | Własna maszyna wirtualna w AWS. | Długie procesy, specyficzny soft, pełna kontrola. |
| AWS Lambda | globalnie | Funkcje uruchamiane zdarzeniem, płatne za wywołanie. | Klient na AWS; zdarzenia z S3/SQS. |
| Google Cloud Run | globalnie | Kontener skalowany do zera. | Python/Go w kontenerze, dłuższe requesty niż serverless. |
| Azure App Service | globalnie | Hosting aplikacji web w Azure. | Klient z umową Microsoft/Azure. |
| Azure Functions | globalnie | Serverless w Azure. | Zdarzenia i integracje w ekosystemie Microsoft 365. |
| Cloudflare Workers | globalnie | Kod na brzegu sieci blisko użytkownika. | Globalny ruch, proxy/API, tani przy dużej liczbie requestów. |
| Fly.io | globalnie | Kontenery/maszyny w wybranych regionach blisko użytkownika. | WebSockety, stan w pamięci, region w Europie. |
| Railway | globalnie | PaaS: repo → serwis + baza w kilka kliknięć. | Worker, cron albo kontener, którego Vercel nie uciągnie. |
| Render | globalnie | PaaS w stylu Heroku: web, workery, cron, Postgres. | Proste background workery i usługi długo działające. |
| Netlify | globalnie | Hosting Jamstack, alternatywa dla Vercel. | Statyczne strony, wbudowane formularze. |
| DigitalOcean | globalnie | Tanie VPS + App Platform. | Przewidywalny miesięczny koszt, własny serwer. |
| Hetzner | UE | Europejskie serwery i VPS, dane w UE, niski koszt. | Własny serwer w UE: workery, self-host (n8n, Infisical), RODO. |
| OVHcloud | Polska | Europejska chmura i serwery, w tym regiony w Polsce. | Klient wymaga danych w Polsce/UE albo chmury europejskiej. |

### Auth (`stack-auth`) — trudno cofnac (drzwi jednokierunkowe pilnuja obszary SD)

Pytanie: Kto się loguje, czym i czy są organizacje/role? Zwykle u nas: Supabase Auth, Payload auth. PG: T3 zawsze; `security-reviewer` + RLS od dnia 0.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Clerk | globalnie | Gotowe ekrany logowania, organizacje, MFA. | B2B SaaS z organizacjami i gotowym UI, gdy nie ma Supabase. |
| Auth0 | globalnie | Platforma tożsamości enterprise (Okta). | Klient wymaga SSO/SAML i compliance. |
| Supabase Auth | globalnie | Logowanie zintegrowane z RLS w Postgres. | Domyślnie. |
| NextAuth / Auth.js | globalnie | Biblioteka OAuth dla Next; dane zostają u ciebie. | Logowanie Google/GitHub bez dostawcy auth. |
| WorkOS | globalnie | SSO SAML i SCIM dla klientów enterprise. | Sprzedajesz SaaS firmom, które żądają SSO. |
| Firebase Auth | globalnie | Auth z ekosystemu Firebase. | Aplikacja mobilna na Firebase. |
| Better Auth | globalnie | Open-source biblioteka auth w TS z pluginami (2FA, organizacje). | Własne auth w swojej bazie bez uzależnienia od dostawcy. |
| AWS Cognito | globalnie | Tożsamość w AWS. | Klient w pełni na AWS. |
| Microsoft Entra ID | globalnie | Konta firmowe Microsoft (dawne Azure AD). | Pracownicy klienta logują się kontem Microsoft 365. |
| Payload auth | globalnie | Konta i role wbudowane w Payload CMS. | Sklep/panel na Payload. |

### AI / LLM (`stack-ai`)

Pytanie: Czy produkt ma część AI, i jaki ma limit kosztu? Zwykle u nas: Anthropic Claude, Vercel AI SDK. PG: Model per krok: skill `model-router`; cap kosztu per organizacja.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Anthropic Claude | globalnie | Modele Claude (Haiku/Sonnet/Opus). | Domyślnie. |
| OpenAI | globalnie | Modele GPT, embeddingi, mowa (Whisper, TTS). | Transkrypcja/głos albo konkretny model. |
| Vercel AI Gateway | globalnie | Jeden endpoint do wielu dostawców z fallbackiem i limitami. | Przełączanie modeli bez zmiany kodu, jeden rachunek. |
| Google Gemini | globalnie | Modele Google z długim kontekstem i multimodalnością. | Dużo wideo/PDF w jednym zapytaniu, niski koszt. |
| Replicate | globalnie | Modele open-source (obraz, audio, wideo) przez API. | Konkretny model OSS bez własnego GPU. |
| Together AI | globalnie | Hosting otwartych modeli (Llama, Qwen) + fine-tuning. | Otwarty model albo dostrojenie na własnych danych. |
| Groq | globalnie | Bardzo szybka inferencja na własnych układach. | Niski czas odpowiedzi, np. agent głosowy. |
| Vercel AI SDK | globalnie | Biblioteka TS do LLM: streaming, narzędzia, wielu dostawców. | Domyślnie w produktach z AI. |
| Mistral | UE | Europejski dostawca modeli (Francja), także modele otwarte. | Klient wymaga dostawcy z UE albo modelu do self-hostu. |

### Realtime (`stack-rtm`)

Pytanie: Czy ktoś musi widzieć zmiany bez odświeżania? Zwykle u nas: Supabase Realtime. PG: Karta `sd/01` stateful vs stateless; WebSocket = osobny koszt i limity.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Supabase Realtime | globalnie | Zmiany z Postgres i kanały broadcast przez WebSocket. | Domyślnie: powiadomienia, statusy, prosty czat. |
| Ably | globalnie | Zarządzane kanały realtime z gwarancjami dostarczenia. | Duża liczba połączeń, historia wiadomości, SLA. |
| Pusher | globalnie | Proste kanały realtime jako usługa. | Szybkie powiadomienia na żywo bez własnego serwera. |
| Liveblocks | globalnie | Współdzielona edycja i obecność użytkowników. | Wspólna edycja dokumentu/tablicy, kursory innych. |
| Polling | globalnie | Okresowe odpytywanie API. | Zmiany co minuty, nie sekundy: najtańsze i najprostsze. |

### Joby / automatyzacja (`stack-jobs`)

Pytanie: Co dzieje się poza requestem: cron, kolejka, długie zadania? Zwykle u nas: Edge Function + cron, n8n. PG: n8n tylko wewnętrznie; produkcja klienta = kod w repo z testami.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Edge Function + cron | globalnie | Kod w Supabase wywoływany harmonogramem (pg_cron). | Domyślnie dla produkcji klienta. |
| Inngest | globalnie | Funkcje sterowane zdarzeniami z ponawianiem i krokami. | Wieloetapowe procesy w tle z retry, bez własnej kolejki. |
| Trigger.dev | globalnie | Długie zadania w tle w TS (open source). | Importy, generowanie raportów dłuższe niż limit funkcji. |
| QStash (Upstash) | globalnie | Kolejka HTTP z opóźnieniem i ponawianiem. | Proste opóźnione wywołania i webhooki z retry. |
| GitHub Actions cron | globalnie | Zadanie cykliczne w CI. | Raporty i joby bez bazy. |
| n8n | globalnie | Automatyzacje wizualne, self-host. | Domyślnie dla pracy wewnętrznej. |
| Zapier | globalnie | Automatyzacje SaaS dla nietechnicznych. | Klient sam ma utrzymywać automatyzację. |
| Make | globalnie | Wizualne scenariusze automatyzacji. | Jak Zapier, tańszy przy wielu krokach. |

## Dane

### Database (`stack-db`) — trudno cofnac (drzwi jednokierunkowe pilnuja obszary SD)

Pytanie: Gdzie leżą dane i jaki mają kształt? Zwykle u nas: Supabase. PG: Nowa tabela = ADR; migracje dwuetapowe (`design.md B.4`).

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| PostgreSQL | globalnie | Sama baza (self-host albo zarządzana, np. RDS). | Gdy potrzebujesz tylko bazy, bez platformy. |
| Neon | globalnie | Serverless Postgres z gałęzią bazy na każdy PR. | Skalowanie do zera albo gdy Supabase Branching (płatny) nie pasuje — najpierw sprawdź Branching. |
| Supabase | globalnie | Postgres + Auth + Storage + Edge Functions + Realtime. | Domyślnie. |
| PlanetScale | globalnie | Zarządzana baza na Vitess, zmiany schematu przez gałęzie. | Duża skala zapisu, zespół MySQL. |
| MySQL | globalnie | Klasyczna relacyjna baza. | WordPress albo system klienta na MySQL. |
| MongoDB | globalnie | Dokumentowa baza NoSQL. | Dane o bardzo zmiennym kształcie (zwykle wystarczy JSONB w Postgres). |
| Firebase | globalnie | Backend Google: Firestore z realtime i trybem offline. | Aplikacja mobilna z synchronizacją offline. |
| DynamoDB | globalnie | Klucz-wartość AWS w dowolnej skali. | Znany z góry wzorzec dostępu, ogromna skala na AWS. |
| Convex | globalnie | Reaktywny backend: baza + funkcje TS + zapytania na żywo. | Współdzielony stan na żywo (tablica, czat) bez pisania synchronizacji. |
| Turso | globalnie | Rozproszony SQLite (libSQL), replika blisko użytkownika. | Osobna baza na klienta, edge, tanio. |
| Redis | globalnie | Szybka pamięć klucz-wartość. | Cache, rate limit, kolejki, sesje (np. Upstash serverless). |
| SQL Server | globalnie | Relacyjna baza Microsoft. | System klienta na Microsoft. |
| Azure SQL | globalnie | SQL Server jako usługa w Azure. | Klient w Azure. |
| Cosmos DB | globalnie | Globalnie rozproszona NoSQL w Azure. | Dane w wielu regionach świata u klienta w Azure. |

### ORM / Data Layer (`stack-orm`)

Pytanie: Jak kod rozmawia z bazą i kto pilnuje uprawnień? Zwykle u nas: supabase-js, Payload Local API. PG: Payload Local API domyślnie omija `access`.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Prisma | globalnie | ORM ze schematem, migracjami i generowanym klientem. | Zespół woli podejście schema-first, dużo relacji. |
| Drizzle | globalnie | Lekki ORM TS blisko SQL, działa na edge. | Typowane zapytania bez ciężkiego runtime. |
| Kysely | globalnie | Typowany query builder SQL. | SQL z typami, bez ORM. |
| TypeORM | globalnie | ORM z dekoratorami (styl Javy). | Przejmowany kod NestJS. |
| Sequelize | globalnie | Starszy ORM dla Node. | Przejmowany stary kod. |
| Raw SQL | globalnie | Ręcznie pisany SQL, funkcje i widoki Postgres. | Raporty, złożone zapytania, logika w bazie. |
| Entity Framework Core | globalnie | ORM dla .NET. | Backend w ASP.NET Core. |
| supabase-js | globalnie | Klient Supabase; z kluczem anon/JWT użytkownika zapytania przechodzą przez RLS, z service_role RLS jest OMIJANY (filtr org_id w kodzie). | Domyślnie. |
| Payload Local API | globalnie | Zapytania przez Payload na serwerze. | Sklep/panel na Payload. |

### File / Blob Storage (`stack-blob`) — trudno cofnac (drzwi jednokierunkowe pilnuja obszary SD)

Pytanie: Czy są pliki użytkowników i kto może je pobrać? Zwykle u nas: Supabase Storage. PG: Bucket i ścieżki = `one_way` w macierzy obszarów.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| AWS S3 | globalnie | Standard magazynu obiektowego. | Duża skala, ekosystem AWS. |
| Vercel Blob | globalnie | Pliki hostowane w Vercel. | Mała aplikacja bez Supabase. |
| Cloudflare R2 | globalnie | Magazyn zgodny z S3 bez opłat za transfer wychodzący. | Dużo pobrań: wideo, galerie, pliki do ściągnięcia. |
| Google Cloud Storage | globalnie | Magazyn obiektowy GCP. | Klient w Google Cloud. |
| Azure Blob | globalnie | Magazyn obiektowy Azure. | Klient w Azure. |
| UploadThing | globalnie | Upload plików dla React/Next z gotowym UI. | Szybki upload bez konfigurowania S3. |
| Supabase Storage | globalnie | Pliki z politykami RLS obok bazy. | Domyślnie. |

### Search (`stack-search`)

Pytanie: Czy użytkownik czegoś szuka, i ile tego jest? Zwykle u nas: Postgres FTS, pgvector. PG: FTS → pgvector → dopiero osobny silnik (`owner-stack`).

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Algolia | globalnie | Hostowane wyszukiwanie natychmiastowe z merchandisingiem. | Sklep z dużym katalogiem, klient płaci za jakość. |
| Meilisearch | globalnie | Open-source, tolerancja literówek, prosty self-host. | Katalog z literówkami i filtrami, tanio. |
| Typesense | globalnie | Open-source alternatywa dla Algolii. | Jak Meilisearch; wybór według potrzebnych funkcji. |
| Elastic | globalnie | Pełny silnik wyszukiwania i analityki logów. | Ogromne zbiory danych, analityka logów. |
| Postgres FTS | globalnie | Pełnotekstowe szukanie w Postgres (+ pg_trgm, unaccent; polski słownik wymaga konfiguracji). | Domyślnie. |
| pgvector | globalnie | Embeddingi i wyszukiwanie semantyczne w Postgres. | Domyślnie dla RAG. |

### CMS / Content (`stack-cms`)

Pytanie: Kto i jak często zmienia treści? Zwykle u nas: Payload, Tabela w Supabase. PG: To, co zmienia klient, ma być danymi, nie kodem.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Sanity | globalnie | Headless CMS, edycja na żywo, wielu redaktorów. | Zespół marketingu klienta edytuje dużo treści. |
| Contentful | globalnie | Headless CMS enterprise. | Korporacja ze standardem Contentful. |
| Payload | globalnie | CMS w kodzie (TS) na Postgres, panel admina. | Domyślnie dla sklepu/panelu treści. |
| Strapi | globalnie | Open-source headless CMS do self-hostingu. | Panel treści na własnym serwerze. |
| Notion | globalnie | Notion jako źródło treści przez API. | Klient już pisze wszystko w Notion. |
| Markdown / MDX | globalnie | Treść w plikach w repo. | Blog dewelopera, dokumentacja. |
| Tabela w Supabase | globalnie | Treści jako wiersze w bazie + prosty formularz. | Domyślnie dla prostych stron. |

## Operacje

### Monitoring / APM (`stack-mon`)

Pytanie: Skąd dowiemy się o błędzie przed klientem? Zwykle u nas: Sentry. PG: Sentry od dnia 0; brak = finding (`fleet-status`).

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Sentry | globalnie | Błędy + wydajność + nagrania sesji. | Domyślnie od dnia 0. |
| Datadog | globalnie | Pełna obserwowalność enterprise: logi, metryki, APM. | Duża infrastruktura, klient płaci. |
| New Relic | globalnie | APM i obserwowalność enterprise. | Klient ma już New Relic. |
| AWS CloudWatch | globalnie | Logi i metryki AWS. | Aplikacja na AWS. |
| Google Cloud Monitoring | globalnie | Logi i metryki GCP. | Aplikacja na Cloud Run/GCP. |
| Grafana | globalnie | Dashboardy (+ Loki na logi, Tempo na trace'y). | Własne metryki, self-host. |
| Prometheus | globalnie | Zbieranie metryk, zwykle z Grafaną. | Własne serwery i kontenery. |
| Honeycomb | globalnie | Trace'y i zdarzenia o wysokiej kardynalności. | Debugowanie systemu z wieloma usługami. |
| Axiom | globalnie | Tanie przechowywanie logów i zdarzeń, integracja z Vercel. | Długie trzymanie logów z Vercel/edge. |
| Better Stack | globalnie | Uptime + logi + strona statusu + dyżury. | Monitoring dostępności i publiczna strona statusu dla klienta. |

### Product Analytics (`stack-pa`)

Pytanie: Jaką metrykę z PRD-lite mierzymy i jakim eventem? Zwykle u nas: brak (zalezy od rynku/produktu). PG: PRD-lite `A.4` wymaga metryki i eventu; flota nie ma tu domyślnego narzędzia.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| PostHog | globalnie | Analityka produktu + nagrania sesji + feature flagi + A/B; open source, hosting w EU. | Pierwszy kandydat: jedna paczka zamiast czterech narzędzi. |
| Amplitude | globalnie | Lejki, kohorty, retencja na poziomie enterprise. | Duży produkt z zespołem analityków. |
| Mixpanel | globalnie | Analityka zdarzeń i lejków. | Klasyczne lejki konwersji. |
| Heap | globalnie | Automatycznie zbiera kliknięcia bez ręcznego trackingu. | Nie wiesz jeszcze, co mierzyć. |
| June | globalnie | Analityka dla B2B SaaS (sprawdź aktualny status projektu). | Raporty per firma-klient. |
| Statsig | globalnie | Feature flagi i eksperymenty z analityką. | Dużo testów A/B. |

### Web Analytics (`stack-wa`)

Pytanie: Czy liczymy ruch na stronie, i czy wymaga to zgody cookie? Zwykle u nas: brak (zalezy od rynku/produktu). PG: GA wymaga zgody cookie (RODO); bez cookies = prostszy baner.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Vercel Analytics | globalnie | Odsłony i Web Vitals wbudowane w Vercel. | Strona na Vercel, minimum konfiguracji. |
| Google Analytics | globalnie | Darmowa, pełna analityka; cookies i zgoda RODO. | Klient prowadzi Google Ads. |
| Plausible | UE | Lekka analityka bez cookies, z EU, open source. | Strona klienta z prostszym RODO. |
| Fathom | globalnie | Prywatna, płatna analityka bez cookies. | Jak Plausible, inny dostawca. |
| Simple Analytics | UE | Prywatna analityka z EU. | Jak Plausible, inny dostawca. |
| Umami | globalnie | Open-source analityka bez cookies do self-hostu. | Dane analityczne na własnym serwerze. |

### CI / CD (`stack-ci`)

Pytanie: Jak kod trafia na produkcję i co go zatrzymuje? Zwykle u nas: GitHub Actions, Vercel Deploys. PG: `quality.yml` + ochrona main; czerwone = brak merge.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| GitHub Actions | globalnie | CI w GitHub. | Domyślnie. |
| Vercel Deploys | globalnie | Deploy i preview na każdy push. | Domyślnie. |
| CircleCI | globalnie | CI jako usługa z mocnym cache. | Długie buildy, klient już używa. |
| GitLab CI | globalnie | CI wbudowane w GitLab. | Kod klienta na GitLabie. |
| Buildkite | globalnie | CI z własnymi runnerami. | Duże monorepo, własna infrastruktura. |

### Sekrety (`stack-sec`)

Pytanie: Gdzie żyją klucze i kto je rotuje? Zwykle u nas: Infisical, Vercel env. PG: Nigdy w kodzie; most `infisical`.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Infisical | globalnie | Menedżer sekretów (self-host albo chmura). | Domyślnie. |
| Vercel env | globalnie | Zmienne środowiskowe projektu w Vercel. | Domyślnie dla produkcji. |
| Doppler | globalnie | Menedżer sekretów jako usługa. | Klient chce SaaS zamiast self-host. |
| 1Password | globalnie | Sekrety w 1Password (CLI, Secrets Automation). | Zespół klienta już używa 1Password. |
| AWS Secrets Manager | globalnie | Sekrety z rotacją w AWS. | Aplikacja na AWS. |

## Biznes i rynek

### Transactional Email (`stack-mail`)

Pytanie: Jakie maile wysyła system i z jakiej domeny? Zwykle u nas: Resend. PG: SPF/DKIM/DMARC na domenie; dostawca = ADR (`design.md E`).

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Resend | globalnie | Proste API e-mail + szablony React Email. | Domyślnie. |
| Postmark | globalnie | Nastawiony na dostarczalność wiadomości transakcyjnych. | Krytyczne maile (reset hasła, faktury) muszą dojść. |
| SendGrid | globalnie | Duży wolumen + marketing (Twilio). | Masowe wysyłki. |
| AWS SES | globalnie | Bardzo tani przy dużej skali, więcej konfiguracji. | Setki tysięcy maili, klient na AWS. |
| Mailgun | globalnie | API + przetwarzanie maili przychodzących. | Aplikacja ma odbierać maile. |
| Loops | globalnie | E-mail marketing i sekwencje dla SaaS. | Onboarding, newslettery, kampanie. |
| Brevo | UE | Europejska platforma e-mail i SMS (transakcyjne + marketing). | Klient chce dostawcy z UE i jednego narzędzia do kampanii. |

### Payments (`stack-pay`) — trudno cofnac (drzwi jednokierunkowe pilnuja obszary SD)

Pytanie: Kto płaci, w jakiej walucie i kto rozlicza VAT? Zwykle u nas: brak (zalezy od rynku/produktu). PG: Hostowany checkout + webhook HMAC + idempotencja; T3. Dostawca zależy od rynku.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Stripe | globalnie | Standard płatności, subskrypcje, Connect; obsługuje też BLIK i Przelewy24. | Globalnie; subskrypcje, marketplace (Connect). |
| Lemon Squeezy | globalnie | Merchant of Record: rozlicza VAT za ciebie. | Sprzedaż produktów cyfrowych na świat. |
| Paddle | globalnie | Merchant of Record dla SaaS. | Subskrypcje SaaS globalnie bez własnej rejestracji VAT. |
| Polar | globalnie | Merchant of Record dla deweloperów: subskrypcje, licencje. | Sprzedaż narzędzi/licencji dla programistów. |
| PayPal | globalnie | Płatności kontem PayPal. | Klienci przyzwyczajeni do PayPal. |
| Przelewy24 | Polska | Polska bramka: szybkie przelewy, BLIK, karty. | Sklep/usługa dla klientów w Polsce. |
| PayU | Polska | Bramka płatności w Polsce i regionie (BLIK, raty, karty). | Sklep w PL, raty i płatności odroczone. |
| Tpay | Polska | Polska bramka z BLIK i szybkimi przelewami. | Mały sklep w PL, prosta integracja. |
| Mollie | UE | Europejska bramka z lokalnymi metodami płatności. | Sprzedaż w wielu krajach UE. |
| Adyen | globalnie | Globalna platforma płatności enterprise. | Duży wolumen, wiele krajów i kanałów. |
| Rapyd | Islandia | Hostowany checkout, subskrypcje, wiele walut (w tym ISK). | Produkty floty na rynku islandzkim. |
| Straumur | Islandia | Islandzki procesor płatności krajowych. | Płatności w ISK na rynku islandzkim. |

### Faktury / księgowość (`stack-inv`)

Pytanie: Czy system wystawia faktury, i w jakim kraju? Zwykle u nas: brak (zalezy od rynku/produktu). PG: W Polsce faktury idą przez KSeF; sprawdź aktualny harmonogram obowiązku.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| KSeF (API MF) | Polska | Krajowy System e-Faktur: polskie ustrukturyzowane e-faktury. | Wystawiasz faktury w Polsce bezpośrednio z systemu. |
| Fakturownia | Polska | Polski SaaS do faktur z API (integracja z KSeF). | Faktury PL bez własnej integracji z KSeF. |
| inFakt | Polska | Polski SaaS do faktur i księgowości z API. | Klient prowadzi księgowość w inFakt. |
| wFirma | Polska | Polski SaaS księgowy z API. | Klient prowadzi księgowość w wFirma. |
| Stripe Invoicing | globalnie | Faktury i subskrypcje w Stripe. | Płatności i tak idą przez Stripe, rynek poza PL. |
| Xero | globalnie | Księgowość w chmurze z API (UK, AU, NZ i inne). | Klient poza Polską z księgowością w Xero. |
| Merchant of Record | globalnie | Faktury wystawia dostawca płatności (Paddle, Lemon Squeezy, Polar). | Sprzedaż cyfrowa na świat bez własnego VAT. |

### e-ID / podpis (`stack-eid`) — trudno cofnac (drzwi jednokierunkowe pilnuja obszary SD)

Pytanie: Czy prawo wymaga potwierdzonej tożsamości albo podpisu? Zwykle u nas: brak (zalezy od rynku/produktu). PG: Kupuj, nie buduj weryfikacji tożsamości; dane osobowe = RODO + T3.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Brak | globalnie | Produkt nie potrzebuje e-ID ani podpisu. | Brak wymogu prawnego. |
| Profil Zaufany / login.gov.pl | Polska | Logowanie obywatela przez Węzeł Krajowy. | Usługa dla obywateli PL wymaga potwierdzonej tożsamości. |
| mObywatel | Polska | Cyfrowa tożsamość w aplikacji państwowej. | Weryfikacja tożsamości osoby w Polsce. |
| Autenti | Polska | Polska platforma podpisu elektronicznego. | Umowy podpisywane online z klientami w PL. |
| DocuSign | globalnie | Globalna platforma podpisu elektronicznego. | Umowy międzynarodowe, klient zna DocuSign. |
| Signicat | UE | Europejski agregator e-ID i podpisu dla wielu krajów. | Jedna integracja na kilka krajów UE i Nordyki. |
| Dokobit | Islandia | Podpis i e-ID w krajach bałtyckich i nordyckich. | Podpis prawnie wiążący w Islandii/Bałtyku. |
| eid-provider | Islandia | Islandzka narodowa tożsamość cyfrowa. | Islandia; zwykle przez Signicat. |

### SMS / głos (`stack-sms`)

Pytanie: Czy kontaktujemy się telefonicznie lub SMS-em? Zwykle u nas: Twilio. PG: Koszt per wiadomość = cap i alert (`prr.md`).

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Twilio | globalnie | SMS, głos, IVR na całym świecie. | Domyślnie poza PL; głos i IVR. |
| SMSAPI | Polska | Polska bramka SMS z API. | Tanie i pewne SMS-y do odbiorców w Polsce. |
| Vonage | globalnie | Globalne API SMS i głosu. | Alternatywa dla Twilio, klient ma umowę. |
| RetellAI | globalnie | Platforma agentów głosowych AI. | Agent telefoniczny rozmawiający z klientami. |
| Brak | globalnie | Bez SMS i telefonii. | Produkt bez kanału telefonicznego. |

### Wysyłka (`stack-ship`)

Pytanie: Czy fizyczny towar trafia do klienta? Zwykle u nas: brak (zalezy od rynku/produktu). PG: Tylko sklepy z towarem; status przesyłki = webhook + idempotencja.

| Narzedzie | Rynek | Co to | Kiedy |
|---|---|---|---|
| Brak | globalnie | Produkt cyfrowy albo usługa. | Nic nie jest wysyłane. |
| InPost (API) | Polska | Paczkomaty i kurier InPost. | Sklep wysyłający w Polsce. |
| Furgonetka | Polska | Polski broker wielu kurierów z jednym API. | Kilku kurierów w PL bez osobnych umów. |
| Shippo | globalnie | Globalne API etykiet i stawek przewoźników. | Wysyłki za granicę, wielu przewoźników. |
| EasyPost | globalnie | Globalne API wysyłek i śledzenia. | Jak Shippo, inny dostawca. |

## Przyklady: kiedy zwykly fundament (Supabase + Vercel + Resend) nie wystarcza

| Przyklad | Sygnal | Zmienia |
|---|---|---|
| Sklep z towarem w Polsce | Klienci płacą BLIK-iem, paczki idą do paczkomatów, faktury przez KSeF. | Przelewy24, InPost (API), Fakturownia, SMSAPI, Plausible |
| SaaS B2B na całą UE | Firmy z kilku krajów, subskrypcje, dane w UE. | Hetzner, Paddle, Merchant of Record, PostHog |
| Usługa dla obywateli w PL | Tożsamość musi być potwierdzona (np. wniosek, umowa). | OVHcloud, Profil Zaufany / login.gov.pl, Autenti |
| Współdzielony stan na żywo | Tablica, wspólna edycja, czat: wielu użytkowników widzi zmiany natychmiast. | Clerk, Convex, Liveblocks |
| Dużo pobieranych plików | Wideo, galerie, pliki do ściągnięcia: transfer wychodzący zjada budżet. | Cloudflare R2 |
| SaaS dla firm z SSO | Klient enterprise żąda logowania kontem firmowym (SAML/SCIM). | WorkOS, PostHog |
| Klient na Microsoft 365 | Pracownicy logują się kontem firmowym, IT klienta pilnuje Azure. | ASP.NET Core (.NET), Azure App Service, Microsoft Entra ID, Azure SQL, Entity Framework Core, Azure Blob |
| Sprzedaż software'u na świat | Subskrypcje w wielu krajach bez własnej rejestracji VAT. | Loops, Paddle, Merchant of Record, PostHog |
| Ciężki Python obok aplikacji | OCR, pandas, modele ML: biblioteki są tylko w Pythonie. | Python (FastAPI), Google Cloud Run, Google Cloud Monitoring |
| Strona z treścią pod SEO | Blog, poradnik, landing: liczy się szybkość i łatwa edycja. | Astro, Sanity, Plausible |
| Osobna baza na klienta | Twarda izolacja danych per klient albo baza blisko użytkownika. | Better Auth, Turso, Drizzle, Cloudflare R2 |
| Baza na każdy preview PR | Testy migracji na kopii bazy dla każdej gałęzi (najpierw Supabase Branching — zostajesz na Supabase). | Better Auth, Neon, Drizzle |
| Długie joby i kolejki | Generowanie raportów, importy, przetwarzanie dłuższe niż limit funkcji. | Redis, Trigger.dev |
| Duży katalog do przeszukania | Tysiące produktów, literówki, filtry fasetowe. | Meilisearch |
| Agent głosowy | Rozmowa telefoniczna z AI: liczy się czas odpowiedzi. | Groq, RetellAI |
