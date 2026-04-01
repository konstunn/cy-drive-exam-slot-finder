package bot

import (
	"testing"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/konstunn/cy-drive-exam-slot-finder/pkg"
	"github.com/stretchr/testify/suite"
)

// Mock implementation of TelegramBot for testing
type mockBot struct {
	sentMessages []tgbotapi.MessageConfig
}

func (m *mockBot) GetUpdatesChan(config tgbotapi.UpdateConfig) tgbotapi.UpdatesChannel {
	// Return a channel that we can control in tests
	ch := make(chan tgbotapi.Update, 1)
	return ch
}

func (m *mockBot) Send(c tgbotapi.Chattable) (tgbotapi.Message, error) {
	if msg, ok := c.(tgbotapi.MessageConfig); ok {
		m.sentMessages = append(m.sentMessages, msg)
	}
	return tgbotapi.Message{}, nil
}

// Mock implementation of Scraper for testing
type mockScraper struct{}

func (m *mockScraper) Login(creds pkg.Credentials) error {
	// Mock successful login
	return nil
}

func (m *mockScraper) FindAvailableSlots() ([]pkg.ExamTimeSlot, error) {
	return []pkg.ExamTimeSlot{
		{Time: time.Now(), ExamCenterCity: "Λεμεσού", LicenseCategory: "ΒΒ"},
	}, nil
}

// BotTestSuite defines the test suite for bot functionality
type BotTestSuite struct {
	suite.Suite
	mockAPI   *mockBot
	mockScrap *mockScraper
	bot       *Bot
}

// SetupTest is called before each test method
func (suite *BotTestSuite) SetupTest() {
	suite.mockAPI = &mockBot{}
	suite.mockScrap = &mockScraper{}
	suite.bot = NewBot(suite.mockAPI, suite.mockScrap)
}

// TestGetReply tests the reply generation logic
func (suite *BotTestSuite) TestGetReply() {
	tests := []struct {
		input    string
		expected string
	}{
		{"/start", "Hello! I'm a driving exam slot finder bot. Send me any text, and I'll repeat it."},
		{"/find_slots", "Searching for available slots..."},
		{"hello", "You said: hello"},
		{"", "You said: "},
		{"test message", "You said: test message"},
	}

	for _, test := range tests {
		result := suite.bot.getReply(test.input)
		suite.Equal(test.expected, result, "getReply(%q) should return expected result", test.input)
	}
}

// TestHandleUpdate tests message handling
func (suite *BotTestSuite) TestHandleUpdate() {
	// Create a test update
	update := tgbotapi.Update{
		Message: &tgbotapi.Message{
			Text:      "test message",
			Chat:      &tgbotapi.Chat{ID: 123},
			MessageID: 456,
		},
	}

	suite.bot.HandleUpdate(update)

	// Check that a message was sent
	suite.Len(suite.mockAPI.sentMessages, 1, "Should send exactly one message")

	sent := suite.mockAPI.sentMessages[0]
	suite.Equal("You said: test message", sent.Text)
	suite.Equal(int64(123), sent.ChatID)
	suite.Equal(456, sent.ReplyToMessageID)
}

// TestHandleUpdate_StartCommand tests the start command
func (suite *BotTestSuite) TestHandleUpdate_StartCommand() {
	update := tgbotapi.Update{
		Message: &tgbotapi.Message{
			Text:      "/start",
			Chat:      &tgbotapi.Chat{ID: 123},
			MessageID: 456,
		},
	}

	suite.bot.HandleUpdate(update)

	suite.Len(suite.mockAPI.sentMessages, 1, "Should send exactly one message")

	sent := suite.mockAPI.sentMessages[0]
	expected := "Hello! I'm a driving exam slot finder bot. Send me any text, and I'll repeat it."
	suite.Equal(expected, sent.Text)
}

// TestHandleUpdate_NoMessage tests handling of non-message updates
func (suite *BotTestSuite) TestHandleUpdate_NoMessage() {
	// Update with no message (e.g., callback query)
	update := tgbotapi.Update{
		// Message is nil
	}

	suite.bot.HandleUpdate(update)

	// Should not send any messages
	suite.Len(suite.mockAPI.sentMessages, 0, "Should not send any messages for non-message update")
}

// TestBotSuite runs the test suite
func TestBotSuite(t *testing.T) {
	suite.Run(t, new(BotTestSuite))
}
