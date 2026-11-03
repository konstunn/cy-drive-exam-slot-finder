# Driving Exam Slot Finder Bot

A Telegram bot for finding available driving exam slots, built with Node.js.

## Project Structure

This project follows a modular architecture with separated concerns:

```
.
├── src/                    # Source code
│   ├── index.js           # Main application entry point
│   ├── bot.js             # Telegram bot logic
│   ├── scraper.js         # Web scraping logic using Puppeteer
│   ├── test-scraper.js    # Test script for scraper functionality
│   └── types.js           # Shared types and documentation
├── package.json           # Node.js dependencies and scripts
├── package-lock.json      # Dependency lock file
└── README.md             # This file
```

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

## Architecture

### Components

1. **src/index.js** - Application entry point, dependency injection
2. **src/bot.js** - Business logic for Telegram bot operations
3. **src/scraper.js** - Business logic for web scraping using Puppeteer
4. **src/types.js** - Shared types and JSDoc documentation

### Dependencies

- **node-telegram-bot-api**: For Telegram bot communication
- **puppeteer**: For headless browser automation and scraping

## Building and Running

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
```

For every subsequent run:

```bash
npm run test-scraper
```

This command automatically loads `.env`; no `export` or `source` commands are
needed. Existing environment variables take precedence over `.env` values.
The Telegram token is not required for this script. It opens a visible browser,
so run it in a graphical desktop session. The `.env` file is ignored by Git.

### Scraper Debug Files

`npm run test-scraper` enables debug capture by default. Each run creates a unique
directory under `debug/` and prints its absolute path. For the bot, enable it with
`SCRAPER_DEBUG=1`. Set `SCRAPER_DEBUG=0` to disable capture in the test script;
`SCRAPER_DEBUG_DIR` overrides the output directory.

Each stage saves the current page DOM and every iframe before and after the
action. On failure, it saves another snapshot and a full-page screenshot before
closing the browser. The HTML includes live form state; login and password fields
are redacted in HTML and hidden in screenshots. Known credentials are also
removed from saved HTML and journal strings. Other page content can contain
personal information, so keep these files local. The default `debug/` is ignored
by Git; add a custom output directory to your ignore rules if needed.

```text
debug/<UTC-timestamp>-<unique-suffix>/
  steps.jsonl
  001-init-browser-before/
  002-init-browser-after/
    page.html
  ...
  012-wait-for-button-error/
    page.html
    frame-01.html
    screenshot.png
```

`steps.jsonl` records each stage's time, phase, URL, expected control, duration,
frame names/URLs, file paths and errors. Start with its last `error` entry and
open the corresponding HTML/frame files to diagnose a failed selector or route.
Snapshot failures are recorded where possible and never replace the scraping
error. The test script returns a nonzero exit code on failure. This diagnostic
mode does not implement booking, cancellation or confirmation actions.

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

1. Define types in `src/types.js` using JSDoc
2. Implement business logic in appropriate `src/` module
3. Update `src/index.js` for dependency injection
4. Add tests in `tests/` using the built-in `node:test` runner

### Testing

```bash
npm test
```

To verify HTML diagnostics with Chrome against a local fixture (no site login):

```bash
node tests/scraper-debug.browser.js
```

### Code Style

This project uses standard JavaScript conventions. Consider using ESLint for code quality.
