# Progressie Boom

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
