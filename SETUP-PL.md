# Uruchomienie status.wirelab.pl (instrukcja dla właściciela)

Wszystko robisz raz. Zajmie około 20 minut.

## 1. Repozytorium na GitHubie

1. github.com → **New repository**. Nazwa: `wirelab-status`. Widoczność: **Public** (darmowe Pages i minuty Actions; lista sprawdzanych adresów będzie jawna, dlatego nie ma w niej dev ani vault). Bez README i licencji.
2. Wypchnij lokalne repo (robi to koordynator):
   ```sh
   git remote add origin git@github.com:<konto>/wirelab-status.git
   git push -u origin main
   ```
3. **Settings → Actions → General**: „Allow all actions” może zostać; w „Workflow permissions” zostaw **Read repository contents** (workflow sam prosi o potrzebne uprawnienia).

## 2. GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → check → Run workflow** (pierwsze uruchomienie ręcznie). Po około minucie strona działa pod `https://<konto>.github.io/wirelab-status/`.
3. **Settings → Environments → github-pages**: domyślnie wdrażać może tylko gałąź `main`. Tak zostaw.

## 3. Domena status.wirelab.pl

1. W DNS domeny wirelab.pl dodaj rekord:

   | Nazwa | Typ | Wartość | TTL |
   |---|---|---|---|
   | `status` | `CNAME` | `<konto>.github.io.` | 3600 |

   (Konto organizacji: `<organizacja>.github.io.`. Bez nazwy repo w wartości.)
2. **Settings → Pages → Custom domain**: `status.wirelab.pl` → Save. Poczekaj, aż sprawdzenie DNS przejdzie (od kilku minut do godziny).
3. Zaznacz **Enforce HTTPS**, gdy stanie się dostępne (certyfikat wystawia GitHub).
4. Zalecane: w ustawieniach konta **Settings → Pages → Add a domain** zweryfikuj `wirelab.pl` (rekord TXT). Chroni to przed przejęciem subdomeny przez cudze repo.
5. Jeśli domena ma rekord CAA, musi dopuszczać `letsencrypt.org`.

## 4. Token dla panelu (incydenty z /admin/status)

1. github.com → avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Nazwa: `wirelab-admin-status`. Expiration: 1 rok (wpisz sobie przypomnienie o odnowieniu).
3. **Repository access → Only select repositories → wirelab-status**.
4. **Permissions → Repository permissions → Contents: Read and write**. Nic więcej (Metadata: Read ustawi się samo).
5. Skopiuj token i przekaż go do `.env` aplikacji na serwerze (np. `STATUS_GITHUB_TOKEN=...`, `STATUS_GITHUB_REPO=<konto>/wirelab-status`). Nie wklejaj go do czatu, maila ani repo.
6. Awaryjnie (serwer leży, panel nie działa): aplikacja GitHub na telefonie → repo `wirelab-status` → `data/incidents.json` → edycja → Commit do `main`. Wzór wpisu jest w `README.md`. Strona odświeży się po 1–2 minutach.

## 5. UptimeRobot (alerty na telefon)

Strona statusu pokazuje stan publicznie, a UptimeRobot budzi Cię, gdy coś padnie. Darmowy plan wystarcza.

1. Załóż konto na uptimerobot.com, zainstaluj aplikację **UptimeRobot** (Android/iOS) i zaloguj się. W aplikacji zezwól na powiadomienia.
2. **My Settings → Alert Contacts**: e-mail jest domyślnie; aplikacja mobilna dodaje się sama po zalogowaniu (push).
3. **Add New Monitor** (interwał 5 min, alert do e-maila i aplikacji):

   | Typ | Nazwa | Adres / host | Uwagi |
   |---|---|---|---|
   | HTTP(s) | wirelab.pl | `https://wirelab.pl/api/health` | do czasu wdrożenia `/api/health`: `https://wirelab.pl/` |
   | Keyword | wirelab.pl health | `https://wirelab.pl/api/health`, słowo `"ok":true`, alert gdy brak | po wdrożeniu health |
   | HTTP(s) | Akademia | `https://akademia.wirelab.pl/` | |
   | HTTP(s) | Blog | `https://blog.wirelab.pl/` | |
   | HTTP(s) | Forum | `https://forum.wirelab.pl/ping` | |
   | HTTP(s) | Docs | `https://docs.wirelab.pl/` | w „Advanced” dopuść kod 401 jako poprawny albo wybierz typ Port 443 |
   | Port | Poczta SMTP | `mail.wirelab.pl`, port 587 | |
   | Port | Poczta IMAP | `mail.wirelab.pl`, port 993 | |
   | HTTP(s) | dev (prywatnie) | `https://dev.wirelab.pl/` | opcjonalnie; tylko alert, nie trafia na stronę statusu |

4. W monitorach HTTP(s) włącz **SSL expiry reminders** (lub w ustawieniach konta: powiadomienie 14 dni przed wygaśnięciem certyfikatu).
5. Nie twórz publicznej strony statusu w UptimeRobot; publiczna jest status.wirelab.pl.

## 6. Na co uważać

- **Forum przed otwarciem**: w `config/services.json` forum ma `"prelaunch": true`, więc jego niedostępność pokazuje się jako „Przed otwarciem”, a nie awaria. Po otwarciu forum zmień na `false`.
- **`/api/health`**: dopóki nie jest wdrożony, sprawdzamy stronę główną. Tryb budowy z odpowiedzią 503 i nagłówkiem `Retry-After` liczy się jako prace serwisowe, nie awaria. Po wdrożeniu nic nie trzeba zmieniać.
- **60 dni bez aktywności**: GitHub wyłącza zaplanowane workflow w publicznym repo bez aktywności. Cogodzinne commity wyników zwykle temu zapobiegają. Jeśli dostaniesz maila „scheduled workflow disabled”, wejdź w **Actions → check → Enable workflow**.
- **Czerwony przebieg w Actions** przy poprawnie działających usługach oznacza zwykle błąd w `data/incidents.json`. Szczegóły są w logu kroku „Validate incidents.json”.
- **Prywatność**: GitHub (USA) widzi adresy IP odwiedzających stronę statusu. Dlatego w polityce prywatności potrzebny jest punkt o przekazaniu poza EOG (GitHub, Data Privacy Framework), dotyczący tylko odwiedzin status.wirelab.pl. Strona nie ustawia ciasteczek; zapamiętuje tylko język i motyw w przeglądarce (localStorage).
