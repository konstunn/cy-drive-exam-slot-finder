package scraper

import (
	"testing"

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

// TestScraperSuite runs the test suite
func TestScraperSuite(t *testing.T) {
	suite.Run(t, new(ScraperTestSuite))
}
