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

### Code Style

This project uses standard JavaScript conventions. Consider using ESLint for code quality.
