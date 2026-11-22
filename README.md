# Progressie Boom

Bij het openen kies je eerst een vak of project. Maak zelf groepen zoals School of Werk aan; deze staan op het selectiescherm standaard dichtgeklapt. Projecten zonder groep zijn direct zichtbaar. Met de groepskeuze bij een project kun je het verplaatsen. Een groep verwijderen behoudt de projecten zonder groep.

Bij elk vak en onderdeel kun je onder 'Gestopt op pagina' een bladwijzer bewaren. Leeg bewaren wist de bladwijzer. Dit is een geheugensteuntje en verandert de afgevinkte voortgang niet. Groepen en bladwijzers blijven bewaard na herstart en gaan mee in JSON-backups.

## Accounts

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
