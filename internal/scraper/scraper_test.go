package scraper

import (
	"testing"
	"time"

	"github.com/konstunn/cy-drive-exam-slot-finder/pkg"
	"github.com/stretchr/testify/suite"
)

// ScraperTestSuite defines the test suite for scraper functionality
type ScraperTestSuite struct {
	suite.Suite
	scraper *ChromeScraper
}

// SetupTest is called before each test method
func (suite *ScraperTestSuite) SetupTest() {
	suite.scraper = NewChromeScraper()
}

// TestNewChromeScraper tests scraper initialization
func (suite *ScraperTestSuite) TestNewChromeScraper() {
	suite.NotNil(suite.scraper, "NewChromeScraper should return a non-nil scraper")
	suite.False(suite.scraper.isLoggedIn, "New scraper should not be logged in initially")
}

// TestChromeScraper_Login tests the login functionality
func (suite *ScraperTestSuite) TestChromeScraper_Login() {
	// Skip this test in CI environments or when Chrome is not available
	suite.T().Skip("Skipping integration test that requires Chrome browser and valid login credentials")

	creds := pkg.Credentials{
		Username: "testuser",
		Password: "testpass",
	}

	// Note: This test will fail with actual login attempt since we're using placeholder URLs
	// In a real implementation, you would mock the chromedp calls or use a test server
	err := suite.scraper.Login(creds)
	suite.Error(err, "Expected login to fail with placeholder implementation")

	// Check that credentials are stored
	suite.Equal("testuser", suite.scraper.creds.Username, "Username should be stored")
	suite.Equal("testpass", suite.scraper.creds.Password, "Password should be stored")
}

// TestChromeScraper_FindAvailableSlots_WithoutLogin tests that scraping fails without login
func (suite *ScraperTestSuite) TestChromeScraper_FindAvailableSlots_WithoutLogin() {
	// Initialize browser first
	err := suite.scraper.InitBrowser(5 * time.Second)
	suite.NoError(err, "InitBrowser should succeed")
	defer suite.scraper.Close()

	_, err = suite.scraper.FindAvailableSlots()
	suite.Error(err, "Expected error when calling FindAvailableSlots without login")

	expectedError := "not logged in: please call Login() first"
	suite.EqualError(err, expectedError, "Should return correct error message")
}

// TestChromeScraper_FindAvailableSlots_WithLogin tests scraping after login
func (suite *ScraperTestSuite) TestChromeScraper_FindAvailableSlots_WithLogin() {
	// Skip this test in CI environments or when Chrome is not available
	suite.T().Skip("Skipping integration test that requires Chrome browser")

	// Initialize browser
	err := suite.scraper.InitBrowser(5 * time.Second)
	suite.NoError(err, "InitBrowser should succeed")
	defer suite.scraper.Close()

	// Mock login by setting the flag (in real implementation, this would be done by actual login)
	suite.scraper.isLoggedIn = true

	slots, err := suite.scraper.FindAvailableSlots()
	suite.NoError(err, "FindAvailableSlots should succeed when logged in")
	suite.NotEmpty(slots, "Should return at least one slot")

	// Check slot structure - using pkg.Slot type
	for i, slot := range slots {
		var _ pkg.Slot = slot // Ensure type compatibility
		suite.NotEmpty(slot.Date, "Slot %d should have a date", i)
		suite.NotEmpty(slot.Time, "Slot %d should have a time", i)
		suite.NotEmpty(slot.Location, "Slot %d should have a location", i)
		suite.NotEmpty(slot.Type, "Slot %d should have a type", i)
	}
}

// TestScraperSuite runs the test suite
func TestScraperSuite(t *testing.T) {
	suite.Run(t, new(ScraperTestSuite))
}