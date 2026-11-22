# ProgresseT

## Vakken En Groepen Delen

Klik op **Delen** bij een vak/project of op **Groep delen** in een uitgeklapte groep om een specifiek JSON-bestand te downloaden. Dit kan ook via **Vak delen** boven een geopende boom. Standaard bevat het bestand alleen de structuur, lengtes en eenheden; vink de optie aan om voortgang en stopposities mee te nemen. Accounts en gegevens van andere projecten worden niet meegestuurd.

Via **Vak of groep importeren** op het startscherm voeg je het bestand als nieuwe kopie toe. Bestaande gegevens blijven behouden en elk onderdeel krijgt een nieuw ID. Een groepsbestand maakt standaard een nieuwe groep aan (bij dezelfde naam volgt een nummer). Je kunt ook een bestaande doelgroep kiezen, of vanuit een uitgeklapte groep **Vak importeren in groep** gebruiken. Voortgang wordt alleen overgenomen als je dat expliciet aanvinkt. De volledige back-upfunctie blijft afzonderlijk beschikbaar voor het vervangen van alle eigen bomen.

Klik op **AI-prompt kopieren**, plak de prompt bij je AI en voeg de inhoudstafel, vaknaam en de begin- en eindpagina van de leerstof toe. De AI krijgt het exacte geneste JSON-formaat met een voorbeeld en rekenregels. Bij ontbrekende eindpagina's of onduidelijke paginagrenzen moet de AI eerst om verduidelijking vragen. Controleer de gegenereerde aantallen voor je het bestand importeert via **Vak of groep importeren**. Als de browser automatisch kopieren blokkeert, verschijnt de prompt zodat je die zelf kunt kopieren.

Gedeelde bestanden gebruiken `app: "ProgresseT"`, `version: 1`, `type: "project"` of `"group"` en een `roots`-lijst. Elk onderdeel bevat `title`, een numerieke `length` en optioneel `children`; het vak heeft een `unit`. Een groepsbestand bevat ook `group: { "title": "School" }`. Er zijn maximaal 5000 onderdelen en 60 niveaus per import toegestaan.

De compacte ProgresseT-header toont je statistieken. Klik erop om de uitleg open of dicht te klappen. De uitleg staat bij het openen van de app standaard dicht.

Gebruik de knop **Gestopt op** naast **+ deel** om een stoppositie in te stellen of te wijzigen. Alleen tijdens het bewerken verschijnt het invoerveld; een opgeslagen positie blijft als kort label zichtbaar. Paginas, Tpoints, uur en taken zijn vaste keuzes in de eenheidsdropdown. Met **Eigen eenheid...** kun je een ander label invullen.

Bij het openen kies je eerst een vak of project. Groepen zoals School of Werk staan standaard dichtgeklapt; projecten zonder groep zijn direct zichtbaar. Via **Instellingen** bij een project verander je de titel, groep en eenheid. Kies **Nieuwe groep maken...** in de groepsdropdown om meteen een groep aan te maken. Dit kan ook tijdens het aanmaken van een project. Een groep verwijderen behoudt de projecten zonder groep.

Kies paginas, Tpoints, uur, taken of typ een eigen eenheid. Alle subdelen nemen de projecteenheid over. Aantallen en stopposities ondersteunen vier decimalen, bijvoorbeeld 2,5 uur. Een andere eenheid wijzigt het label en rekent bestaande aantallen niet om. Bestaande projecten blijven standaard op paginas staan.

Bij elk vak en onderdeel kun je een stoppositie bewaren. Bij paginas heet dit 'Gestopt op pagina', bij andere eenheden 'Gestopt bij'. De positie telt vanaf het begin van dat onderdeel: 25 van 100 paginas betekent 25% afgerond. Dit werkt ook met uren en Tpoints. Voortgang van subdelen telt mee bij hun ouders. Een stoppositie op een ouder overlapt met die van zijn kinderen; de hoogste van beide telt zodat er geen dubbeltelling ontstaat. Het percentage wordt begrensd op 100%.

Afvinken telt het hele onderdeel en alle subdelen als afgerond; de stoppositie en invoerknop verdwijnen dan. Bij opnieuw openen blijft een eerder opgeslagen positie behouden en telt die weer mee. Leeg bewaren wist de positie en de bijbehorende gedeeltelijke voortgang. Groepen, eenheden en stopposities blijven bewaard na herstart en gaan mee in JSON-backups. **Back-up** en **Projecten en vakken** zijn standaard ingeklapt; de projectnavigatie heeft dezelfde groepsindeling als het startscherm.

## Accounts

Het account met gebruikersnaam **Thomas** krijgt automatisch beheerrechten (hoofdletters maken niet uit). Er wordt bij de eerste start geen account aangemaakt. Een bestaand Thomas-account krijgt de rechten zodra deze versie draait. Registreer Thomas zelf voordat je de app publiek deelt, want deze gebruikersnaam bepaalt de beheerrechten.

Via **Accountbeheer** ziet Thomas welke accounts bestaan en hoeveel projecten ze hebben. Thomas kan accounts inclusief hun gegevens verwijderen en nieuwe wachtwoorden instellen. Het eigen beheerdersaccount kan niet worden verwijderd. Bestaande wachtwoorden kunnen niet worden bekeken: alleen wachtwoordhashes worden opgeslagen. Een nieuw ingesteld wachtwoord trekt alle sessies van het betrokken account in; bij wijziging van het eigen wachtwoord moet Thomas opnieuw inloggen.

Maak via het beginscherm een account met gebruikersnaam en wachtwoord (minimaal 10 tekens). Elke gebruiker heeft eigen bomen, voortgang, import en export. Je blijft 30 dagen ingelogd; uitloggen trekt de sessie in.

Bij de eerste registratie krijgt het eerste account de bestaande bomen. Maak dit account dus zelf aan voordat je de server deelt. De oorspronkelijke data wordt eerst gekopieerd naar `data/before-accounts.json`.

Accounts, gehashte wachtwoorden en sessies worden samen met de bomen opgeslagen in `data/state.json`, ook buiten Docker. Bewaar de volledige datamap voor een serverbackup; JSON-export vanuit de app bevat alleen de bomen van de ingelogde gebruiker.

Gebruik HTTPS voor een publiek bereikbare server en stel `COOKIE_SECURE=true` in de containeromgeving in. Lokaal via HTTP laat je deze instelling weg. Wachtwoordherstel en e-mailverificatie zijn niet ingebouwd.

Een kleine webapp om projecten, vakken, hoofdstukken en subdelen in een boomstructuur bij te houden, met voortgang per niveau.

De data wordt altijd opgeslagen in een lokaal JSON-bestand op de server. Dus ook zonder Docker blijft je data behouden na stoppen en opnieuw starten van de site.

## Lokaal draaien

```bash
npm install
npm start
```

Open daarna `http://localhost:3000`.

## Via Docker Compose

```bash
docker compose up --build
```

De data wordt bewaard in `./data/state.json` via een volume.

## Export en import

- Gebruik **Exporteren als JSON** om een backup van je volledige boom te downloaden.
- Gebruik **Importeren en vervangen** om een JSON-backup terug te zetten.
- Het importbestand mag de geëxporteerde structuur bevatten met `nodes`, of een boom met `roots`.

## Wat je kan doen

- Nieuwe projecten of vakken aanmaken.
- Daaronder subdelen toevoegen met een lengte in paginas.
- Elk deel als gedaan markeren.
- Een compleet bovenliggend deel markeren, waardoor alle onderliggende delen ook gedaan zijn.
- Onderdelen aanpassen of verwijderen.
- Exporteren en importeren als JSON.
