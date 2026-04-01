# Driving Exam Slot Finder Bot

A Telegram bot for finding available driving exam slots, built with Go.

## Project Structure

This project follows a clean architecture with separated concerns:

```
.
├── .vscode/          # VS Code configuration
│   ├── launch.json   # Debug and run configurations
│   ├── tasks.json    # Build and test tasks
│   └── settings.json # Editor settings
├── cmd/bot/          # Application entry point
│   └── main.go       # Main application
├── internal/         # Private application code
│   ├── bot/          # Telegram bot logic
│   │   ├── bot.go    # Bot implementation
│   │   └── bot_test.go # Bot tests
│   └── scraper/      # Web scraping logic
│       ├── scraper.go # Chrome-based scraper
│       └── scraper_test.go # Scraper tests
├── pkg/              # Public packages
│   └── types.go      # Shared types and interfaces
├── go.mod            # Go module file
├── go.sum            # Dependency checksums
└── README.md         # This file
```

## Development Setup

### VS Code Configuration

The project includes VS Code configuration files for optimal development experience:

- **launch.json**: Debug configurations for running the bot and tests
- **tasks.json**: Build and test tasks
- **settings.json**: Go-specific editor settings

### Available Debug Configurations

1. **Launch Bot**: Runs the bot in debug mode (requires TELEGRAM_BOT_TOKEN, SCRAPER_USERNAME, SCRAPER_PASSWORD)
2. **Launch Bot (Release)**: Runs the compiled binary
3. **Debug Tests**: Runs all tests in debug mode
4. **Debug Bot Package Tests**: Runs bot package tests specifically

## Architecture

### Layers

1. **cmd/bot** - Application entry point, dependency injection
2. **internal/bot** - Business logic for Telegram bot operations
3. **internal/scraper** - Business logic for web scraping
4. **pkg** - Shared types and interfaces

### Dependencies

- **Telegram Bot API**: For bot communication
- **Chromedp**: For headless browser automation and scraping

## Building and Running

### Prerequisites

- Go 1.26.1+
- Telegram Bot Token (set as `TELEGRAM_BOT_TOKEN` environment variable)
- Scraper credentials (`SCRAPER_USERNAME` and `SCRAPER_PASSWORD` environment variables)

### Environment Variables

The application requires the following environment variables:

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from @BotFather
- `SCRAPER_USERNAME`: Username for the driving exam booking system
- `SCRAPER_PASSWORD`: Password for the driving exam booking system

You can copy `.env.example` to `.env` and fill in your actual values:

```bash
cp .env.example .env
# Edit .env with your credentials
```

### Build

```bash
go build ./cmd/bot
```

Or use VS Code task: `Ctrl+Shift+P` → `Tasks: Run Task` → `build-bot`

### Run

```bash
export TELEGRAM_BOT_TOKEN="your_bot_token"
export SCRAPER_USERNAME="your_username"
export SCRAPER_PASSWORD="your_password"
./bot
```

Or use VS Code debug: `F5` → Select "Launch Bot" → Enter credentials when prompted

### Test

```bash
go test ./...
```

Or use VS Code task: `Ctrl+Shift+P` → `Tasks: Run Task` → `test-all`

## Usage

The bot currently supports:
- `/start` - Welcome message
- `/find_slots` - Search for available slots (placeholder)
- Echo any other message

## Development

### Adding New Features

1. Define interfaces in `pkg/types.go`
2. Implement business logic in appropriate `internal/` package
3. Update main.go for dependency injection
4. Add tests following the existing pattern

### Testing

Each package has its own test file with comprehensive unit tests using mocks for external dependencies. Tests are organized using **testify test suites** for better structure and reusability.

Test suites include:
- **BotTestSuite**: Tests for Telegram bot functionality
- **ScraperTestSuite**: Tests for web scraping operations

Run tests:
```bash
go test ./...          # Run all tests
go test ./internal/bot # Run bot tests only
go test ./internal/scraper # Run scraper tests only
```