package main

import (
	"log"
	"os"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/konstunn/cy-drive-exam-slot-finder/internal/bot"
	"github.com/konstunn/cy-drive-exam-slot-finder/internal/scraper"
	"github.com/konstunn/cy-drive-exam-slot-finder/pkg"
)

func main() {
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	if token == "" {
		log.Fatalf("TELEGRAM_BOT_TOKEN environment variable is required")
	}

	// Get scraping credentials from environment
	username := os.Getenv("SCRAPER_USERNAME")
	password := os.Getenv("SCRAPER_PASSWORD")
	if username == "" || password == "" {
		log.Fatalf("SCRAPER_USERNAME and SCRAPER_PASSWORD environment variables are required")
	}

	api, err := tgbotapi.NewBotAPI(token)
	if err != nil {
		log.Fatalf("Failed to create bot: %v", err)
	}

	api.Debug = false
	log.Printf("Authorized on account %s", api.Self.UserName)

	// Initialize scraper
	slotScraper := scraper.NewChromeScraper()

	// Initialize browser context for scraper
	if err := slotScraper.InitBrowser(60 * time.Second); err != nil {
		log.Fatalf("Failed to initialize browser: %v", err)
	}
	defer slotScraper.Close()

	// Login to the scraping service first
	creds := pkg.Credentials{
		Username: username,
		Password: password,
	}

	log.Println("Logging in to driving exam system...")
	if err := slotScraper.Login(creds); err != nil {
		log.Fatalf("Failed to login to scraping service: %v", err)
	}
	log.Println("Successfully logged in!")

	// Initialize bot with dependencies
	botInstance := bot.NewBot(api, slotScraper)

	// Start the bot
	botInstance.Run()
}
