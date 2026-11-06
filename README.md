# Driving Exam Slot Finder Bot

A Telegram bot for finding available driving exam slots, built with TypeScript and Node.js.

## Development Setup

### Prerequisites

- Node.js 26 LTS, version 26.13.0 or newer within 26.x (pinned in `.tool-versions`)
- npm or yarn

### Installation

With asdf, install the pinned Node.js version from the project root:

```bash
asdf install
```

Then install the dependencies:

```bash
npm ci
```

### Environment Variables

The application requires the following environment variables:

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from @BotFather
- `SCRAPER_USERNAME`: Username for the driving exam booking system
- `SCRAPER_PASSWORD`: Password for the driving exam booking system

You can create a `.env` file in the root directory:

```bash
cp .env.example .env
# Edit .env with your credentials
```

## Dependencies

- **node-telegram-bot-api**: For Telegram bot communication
- **puppeteer**: For headless browser automation and scraping

## Building and Running

Node.js runs the `.ts` files directly using its built-in
[type stripping](https://nodejs.org/api/typescript.html); no build step is needed.
Runtime execution does not check types. Run `npm run check` before committing.

### Run

```bash
npm start
```

Or for development with auto-restart:

```bash
npm run dev
```

### Test Scraper

One-time setup from the project root:

```bash
npm ci
cp .env.example .env
```

Fill in these values in `.env`:

```dotenv
SCRAPER_USERNAME="your_username"
SCRAPER_PASSWORD="your_password"
SCRAPER_CITY_CENTER="your_city_center"
SCRAPER_CAR_PLATE="your_car_plate"
SCRAPER_DRIVING_CATEGORY="your_driving_category"
```

For every subsequent run:

```bash
npm run test-scraper
```

The script loads `.env`, opens a visible browser and finds the nearest available
exam slot. The Telegram token is not required.

### Scraper Debug Files

Debug capture is enabled by default for `test-scraper`. Files are saved under
`debug/`: HTML snapshots, a step journal and screenshots on errors.

Set `SCRAPER_DEBUG=0` to disable capture or `SCRAPER_DEBUG_DIR` to change the
output directory. Debug files may contain personal information; keep them local.

### Environment Setup

```bash
export TELEGRAM_BOT_TOKEN="your_bot_token"
export SCRAPER_USERNAME="your_username"
export SCRAPER_PASSWORD="your_password"
npm start
```

## Usage

The bot currently supports:
- `/start` - Welcome message
- `/find_slots` - Search for available slots (placeholder)
- Echo any other message

## Development

### Adding New Features

1. Define shared types in `src/types.ts` and module-specific types beside their implementation
2. Implement business logic in appropriate `src/` module
3. Update `src/index.ts` for dependency injection
4. Add `.test.ts` tests in `tests/` using the built-in `node:test` runner
5. Run `npm run check` (type checking followed by unit tests)

### Testing

```bash
npm run typecheck
npm test
# Or both:
npm run check
```

To verify HTML diagnostics with Chrome against a local fixture (no site login):

```bash
npm run test:browser
```

### Code Style

The application, manual runner and tests use strict TypeScript, including
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Use explicit `.ts`
extensions for local imports and `import type` for type-only dependencies.
`erasableSyntaxOnly` keeps the syntax compatible with direct Node.js execution;
avoid enums and constructor parameter properties that require compilation.

Slot results have the shape `{ datetime: Date | null, available: boolean }`.
Handle missing dates and nullable browser state explicitly. Caught errors have
type `unknown`; narrow them before accessing their properties.

GitHub Actions runs `npm run check` on pushes and pull requests. Browser tests
run separately with `npm run test:browser` and use local fixtures, without login.
The standalone `finder.js` userscript remains JavaScript for direct installation
in a browser and is outside the application's TypeScript check.
