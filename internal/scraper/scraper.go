package scraper

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/chromedp/chromedp"
	"github.com/konstunn/cy-drive-exam-slot-finder/pkg"
)

// ChromeScraper implements slot scraping using Chrome DevTools Protocol
type ChromeScraper struct {
	creds      pkg.Credentials
	isLoggedIn bool
	ctx        context.Context
	cleanup    func()
}

// NewChromeScraper creates a new Chrome-based scraper
func NewChromeScraper() *ChromeScraper {
	return &ChromeScraper{}
}

// InitBrowser initializes the browser context for the scraper
// Call this method once before performing any operations
func (s *ChromeScraper) InitBrowser(timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)

	// Create chromedp allocator with common options
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.DisableGPU,
		chromedp.NoDefaultBrowserCheck,
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-background-timer-throttling", false),
		chromedp.Flag("disable-backgrounding-occluded-windows", false),
		chromedp.Flag("disable-renderer-backgrounding", false),
	)

	allocCtx, cancelAlloc := chromedp.NewExecAllocator(ctx, opts...)
	taskCtx, cancelTask := chromedp.NewContext(allocCtx, chromedp.WithLogf(log.Printf))

	// Store context and combined cleanup function
	s.ctx = taskCtx
	s.cleanup = func() {
		cancelTask()
		cancelAlloc()
		cancel()
	}

	return nil
}

// Close closes the browser context and cleans up resources
func (s *ChromeScraper) Close() {
	if s.cleanup != nil {
		s.cleanup()
		s.cleanup = nil
		s.ctx = nil
	}
}

// Login authenticates with the driving exam booking system
func (s *ChromeScraper) Login(creds pkg.Credentials) error {
	if s.ctx == nil {
		return fmt.Errorf("browser not initialized: call InitBrowser() first")
	}

	s.creds = creds

	// Navigate to login page
	loginURL := "https://rtd.mcw.gov.cy" // TODO: Replace with actual login URL
	err := chromedp.Run(s.ctx,
		chromedp.Navigate(loginURL),
		chromedp.WaitReady("body"), // Wait for page to load
		chromedp.SendKeys(`input[name="h_USERNAME"]`, creds.Username, chromedp.ByQuery),
		chromedp.SendKeys(`input[name="h_PASSWORD"]`, creds.Password, chromedp.ByQuery),
		chromedp.Click(`button[name="h_LOGIN"]`, chromedp.ByQuery),
		chromedp.WaitReady("body"), // Wait for page load after login
	)
	if err != nil {
		return fmt.Errorf("login failed: %w", err)
	}

	s.isLoggedIn = true
	log.Println("Successfully logged in to driving exam system")
	return nil
}

// FindAvailableSlots searches for available driving exam slots
func (s *ChromeScraper) FindAvailableSlots() ([]pkg.Slot, error) {
	if s.ctx == nil {
		return nil, fmt.Errorf("browser not initialized: call InitBrowser() first")
	}

	if !s.isLoggedIn {
		return nil, fmt.Errorf("not logged in: please call Login() first")
	}

	var slots []pkg.Slot

	url := "https://rtd.mcw.gov.cy/WebPhase1/gui/dlcalendar/CancelRebookCalendar.jsp"

	todayDate := ""

	err := chromedp.Run(s.ctx,
		chromedp.Navigate(url),
		chromedp.WaitReady("body"),
		chromedp.WaitVisible("button"),
		// click next button to proceed with the default one exam
		// TODO: add logic to select the needed exam if > 1 exam is available
		chromedp.Click(`button`, chromedp.ByQuery),

		chromedp.WaitReady("body"),
		chromedp.WaitVisible(`select[name="h_centre"]`, chromedp.ByQuery),
		chromedp.SetValue(`select[name="h_centre"]`, "your-city-value", chromedp.ByQuery),
		chromedp.SetValue(`input[name="h_vrm"]`, "your-plate-value", chromedp.ByQuery),
		// submit exam center and plate number
		chromedp.Click(`button[id="submitBtn"]`, chromedp.ByQuery),

		chromedp.WaitReady("body"),
		chromedp.Value(`input[name="asd"]`, &todayDate, chromedp.ByQuery),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to navigate to calendar: %w", err)
	}

	// Mock slots for demonstration (TODO: Replace with actual scraping)
	slots = append(slots, pkg.Slot{
		Date:     "2026-04-15",
		Time:     "10:00",
		Location: "City Center",
		Type:     "Driving Test",
	})

	return slots, nil
}
