package bot

import (
	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/konstunn/cy-drive-exam-slot-finder/pkg"
)

// Bot represents a Telegram bot for finding driving exam slots
type Bot struct {
	api     pkg.TelegramBot
	scraper pkg.Scraper
}

// NewBot creates a new bot instance
func NewBot(api pkg.TelegramBot, scraper pkg.Scraper) *Bot {
	return &Bot{
		api:     api,
		scraper: scraper,
	}
}

// getReply generates a reply based on the incoming message text
func (b *Bot) getReply(text string) string {
	switch text {
	case "/start":
		return "Hello! I'm a driving exam slot finder bot. Send me any text, and I'll repeat it."
	case "/find_slots":
		return "Searching for available slots..."
	default:
		return "You said: " + text
	}
}

// HandleUpdate processes a single Telegram update
func (b *Bot) HandleUpdate(update tgbotapi.Update) {
	if update.Message == nil {
		return
	}

	reply := b.getReply(update.Message.Text)

	msg := tgbotapi.NewMessage(update.Message.Chat.ID, reply)
	msg.ReplyToMessageID = update.Message.MessageID

	b.api.Send(msg)
}

// Run starts the bot's main event loop
func (b *Bot) Run() {
	u := tgbotapi.NewUpdate(0)
	u.Timeout = 60

	updates := b.api.GetUpdatesChan(u)

	for update := range updates {
		b.HandleUpdate(update)
	}
}
