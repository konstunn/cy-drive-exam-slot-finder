package pkg

import (
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

// TelegramBot defines the interface for Telegram bot operations
type TelegramBot interface {
	GetUpdatesChan(config tgbotapi.UpdateConfig) tgbotapi.UpdatesChannel
	Send(c tgbotapi.Chattable) (tgbotapi.Message, error)
}

// Credentials holds login credentials for the scraping service
type Credentials struct {
	Username string
	Password string
}

// Scraper defines the interface for slot scraping operations
type Scraper interface {
	Login(creds Credentials) error
}

// ExamTimeSlot represents an available driving exam slot
type ExamTimeSlot struct {
	Time            time.Time
	ExamCenterCity  string
	LicenseCategory string
}
