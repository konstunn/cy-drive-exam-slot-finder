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
	loginURL := "https://rtd.mcw.gov.cy"
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

// NavigateToCancelRebook navigates to the rebooking calendar page
func (s *ChromeScraper) NavigateToCancelRebook() error {
	if err := s.checkInitializedLoggedIn(); err != nil {
		return err
	}

	url := "https://rtd.mcw.gov.cy/WebPhase1/gui/dlcalendar/CancelRebookCalendar.jsp"

	err := chromedp.Run(s.ctx,
		chromedp.Navigate(url),
		chromedp.WaitReady("body"),
	)

	if err != nil {
		return fmt.Errorf("failed to navigate to calendar: %w", err)
	}

	return nil
}

// ChooseExistingExam selects the existing exam to proceed with rebooking
func (s *ChromeScraper) ChooseExistingExam() error {
	if err := s.checkInitializedLoggedIn(); err != nil {
		return err
	}

	// now it chooses the default one exam,
	// TODO: add logic to select the needed exam if > 1 exam is available
	err := chromedp.Run(s.ctx,
		chromedp.WaitReady("button"),
		chromedp.Click(`button`, chromedp.ByQuery),
		chromedp.WaitReady("body"),
	)

	if err != nil {
		return fmt.Errorf("failed to choose existing exam: %w", err)
	}
	return nil
}

// GetExamCityCenters retrieves the list of available exam city centers
func (s *ChromeScraper) GetExamCityCenters() ([]string, error) {
	if err := s.checkInitializedLoggedIn(); err != nil {
		return nil, err
	}

	var cityCenters []string

	err := chromedp.Run(s.ctx,
		chromedp.WaitReady("body"),
		chromedp.WaitVisible(`select[name="h_centre"]`, chromedp.ByQuery),
		chromedp.EvaluateAsDevTools(
			`Array.from(document.querySelectorAll('select[name="h_centre"] option')).map(option => option.textContent)`,
			&cityCenters,
		),
	)

	if err != nil {
		return nil, fmt.Errorf("failed to get exam city centers: %w", err)
	}

	return cityCenters, nil
}

// ExamDetails represents the details required to search for available slots
type ExamDetails struct {
	CenterCity     string
	CarPlateNumber string
}

// SubmitExamDetails submits the exam center and plate number to search for available slots
func (s *ChromeScraper) SubmitExamDetails(exam ExamDetails) error {
	if err := s.checkInitializedLoggedIn(); err != nil {
		return err
	}

	if exam.CenterCity == "" || exam.CarPlateNumber == "" {
		return fmt.Errorf("center city and car plate number must be provided")
	}

	err := chromedp.Run(s.ctx,
		chromedp.WaitReady("body"),
		chromedp.WaitVisible(`select[name="h_centre"]`, chromedp.ByQuery),
		chromedp.SetValue(`select[name="h_centre"]`, exam.CenterCity, chromedp.ByQuery),
		chromedp.SetValue(`input[name="h_vrm"]`, exam.CarPlateNumber, chromedp.ByQuery),
		// submit exam center and plate number
		chromedp.Click(`button[id="submitBtn"]`, chromedp.ByQuery),
		chromedp.WaitReady("body"),
	)

	if err != nil {
		return fmt.Errorf("failed to submit exam center and plate: %w", err)
	}
	return nil
}

type GetTimeSlotsAction struct {}

func (a *GetTimeSlotsAction) Do(context.Context) error {
	// This is a placeholder for the actual implementation of retrieving time slots
	// In a real implementation, you would interact with the page to extract available time slots
	return nil
}

// GetTimeSlots retrieves available time slots
func (s *ChromeScraper) GetTimeSlots() ([]time.Time, error) {
	emptyTimes := []time.Time{}

	if err := s.checkInitializedLoggedIn(); err != nil {
		return emptyTimes, err
	}

	var timeSlots []time.Time

	err := chromedp.Run(s.ctx,
		chromedp.WaitReady("body"),
		chromedp.EvaluateAsDevTools(
			`Array.from(document.querySelectorAll('.time-slot')).map(slot => slot.textContent)`,
			&timeSlots,
		),
	)

	if err != nil {
		return emptyTimes, fmt.Errorf("failed to get time slots: %w", err)
	}

	return timeSlots, nil
}

func (s *ChromeScraper) checkInitializedLoggedIn() error {
	if s.ctx == nil {
		return fmt.Errorf("browser not initialized: call InitBrowser() first")
	}

	if !s.isLoggedIn {
		return fmt.Errorf("not logged in: please call Login() first")
	}
	return nil
}
