# Tooling Control App

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Electron](https://img.shields.io/badge/Electron-28-47848F.svg?logo=electron)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)

**Keep full control of your tooling lifecycle — without the spreadsheet chaos.**

</div>

---

## About the project

Tooling Control App was built to solve a real supply chain problem: having clear visibility over supplier tooling without relying on scattered spreadsheets, lost emails, or outdated data.

Everything lives in one place — production data, expiration deadlines, documents, responsible contacts, and action items — so you can act before a tooling issue becomes a supply disruption.

It runs as a local desktop application. No internet required. All data stays on your machine.

---

## What it does

### Supplier Management
Register and monitor your suppliers with a clear overview of how many toolings each one has, which are at risk, and what the overall status of the base looks like. All accessible from an intuitive sidebar.

### Tooling Lifecycle Control
Each tooling item has its own record with:
- Produced quantity and estimated useful life
- Automatically calculated expiration date
- Visual progress bar showing how much of the lifecycle has been consumed
- Customizable status (under analysis, concluded, obsolete, etc.)
- Replacement chain — so you always know which tooling replaces which

### Analytics
A dedicated tab with real-time charts and KPIs:
- How many toolings are expired today
- How many will expire in the coming months
- Breakdown by supplier and status

### Attachments and Documentation
Drag files directly onto the screen — drawings, reports, photos. Everything gets organized by supplier and is accessible in one click.

### Actions and Responsible Contacts
Each supplier has an actions panel where you log what needs to be done, set deadlines, and assign responsible parties (Supply Continuity, SQIE, Planner, Sourcing).

### Settings
- Customize the available status options for your context
- Enable the developer console for debugging when needed
- Everything auto-saves — no Save button, no data loss

---

## Requirements

- Node.js 16 or higher
- npm 8 or higher
- Windows 10/11

---

## How to run

### Install dependencies
```bash
npm install
```

### Development mode
```bash
npm start
```

### Build the installer
```bash
npm run dist
```

The installer will be generated in the `dist/` folder.

---

## Project structure

```
Tooling Control App/
├── src/
│   ├── main/
│   │   ├── main.js              # Electron main process (IPC, database, export)
│   │   ├── preload.js           # Secure bridge between renderer and main
│   │   └── tooling-database.js  # SQLite data access layer
│   └── renderer/
│       ├── index.html           # HTML structure
│       ├── renderer.js          # All UI logic
│       └── style.css            # Visual theme and styles
├── assets/
│   └── ferramentas.ico          # Application icon
├── docs/
│   └── DOCUMENTACAO.md          # Full documentation (pt-BR)
├── package.json                 # Config and dependencies
├── database/
│   └── ferramental_database.db  # Local SQLite database (git-ignored)
└── attachments/                 # User attachments folder (auto-generated)
```

The `database/` and `attachments/` folders stay at the project root — that is
the base directory the main process resolves at runtime. Both are created on
first run. Installations that still keep `ferramental_database.db` loose at the
root have it moved into `database/` automatically at startup.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Electron 28 | Cross-platform desktop shell |
| SQLite3 | Local database |
| Node.js | Runtime and integrations |
| HTML / CSS / JS | Interface without frameworks |
| Phosphor Icons | Icon system |

---

## Developed by

**Rafael Negrao de Souza** — Data Analyst AN62H

---

<div align="center">

*Built for people who need real control, not just another spreadsheet.*

</div>
