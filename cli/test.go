package cli

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// TestCommand handles all "traceform test" subcommands.
func TestCommand(args []string) {
	if len(args) == 0 {
		printTestHelp()
		os.Exit(0)
	}

	switch args[0] {
	case "run":
		testRunCmd(args[1:])
	case "status":
		testStatus(args[1:])
	case "help", "--help", "-h":
		printTestHelp()
		os.Exit(0)
	default:
		fmt.Fprintf(os.Stderr, "Unknown test command: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Run 'traceform test --help' for usage.")
		os.Exit(1)
	}
}

func printTestHelp() {
	fmt.Println(`Usage: traceform test <command> [flags]

Commands:
  run       Trigger a test run for a suite
  status    Check test run status

Run Flags:
  --suite <id>       Test suite ID or name to run (required)
  --ci               CI mode: suppress interactive output, exit 0/1
  --threshold <n>    Minimum pass rate percentage (0-100, default 100)
  --timeout <n>      Max wait time in seconds for results (default 300)
  --format <fmt>     Output format: text (default), json, junit

Global Flags:
  --api-key <key>    API key (or set TRACEFORM_API_KEY)
  --endpoint <url>   API endpoint (or set TRACEFORM_ENDPOINT, default http://localhost:8080)

Examples:
  # Basic test run (interactive)
  traceform test run --suite my-suite

  # CI mode with JUnit output for GitHub Actions / Jenkins
  traceform test run --suite my-suite --ci --threshold 95 --format junit > results.xml

  # CI mode with JSON output
  traceform test run --suite my-suite --ci --format json --threshold 80

  # Check status of a specific run
  traceform test status <run-id>

  # Using explicit API key and endpoint
  traceform test run --suite my-suite --api-key sk_test123 --endpoint https://api.traceform.dev`)
}

// testRunConfig holds parsed flags for the test run command.
type testRunConfig struct {
	SuiteID   string
	CI        bool
	Threshold float64
	Timeout   int
	Format    string
}

func parseTestRunFlags(args []string) testRunConfig {
	cfg := testRunConfig{
		Threshold: 100,
		Timeout:   300,
		Format:    "text",
	}

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--suite":
			if i+1 < len(args) {
				cfg.SuiteID = args[i+1]
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --suite requires a value")
				os.Exit(1)
			}
		case "--ci":
			cfg.CI = true
		case "--threshold":
			if i+1 < len(args) {
				fmt.Sscanf(args[i+1], "%f", &cfg.Threshold)
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --threshold requires a value")
				os.Exit(1)
			}
		case "--timeout":
			if i+1 < len(args) {
				fmt.Sscanf(args[i+1], "%d", &cfg.Timeout)
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --timeout requires a value")
				os.Exit(1)
			}
		case "--format":
			if i+1 < len(args) {
				cfg.Format = args[i+1]
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --format requires a value")
				os.Exit(1)
			}
		case "--help", "-h":
			printTestHelp()
			os.Exit(0)
		default:
			// Positional: treat as suite ID for backward compat
			if cfg.SuiteID == "" && !strings.HasPrefix(args[i], "--") {
				cfg.SuiteID = args[i]
			} else {
				fmt.Fprintf(os.Stderr, "Unknown flag: %s\n", args[i])
				os.Exit(1)
			}
		}
	}

	if cfg.SuiteID == "" {
		fmt.Fprintln(os.Stderr, "Error: --suite is required")
		fmt.Fprintln(os.Stderr, "Run 'traceform test run --help' for usage.")
		os.Exit(1)
	}

	if cfg.Format != "text" && cfg.Format != "json" && cfg.Format != "junit" {
		fmt.Fprintf(os.Stderr, "Error: --format must be text, json, or junit (got %q)\n", cfg.Format)
		os.Exit(1)
	}

	if cfg.Threshold < 0 || cfg.Threshold > 100 {
		fmt.Fprintln(os.Stderr, "Error: --threshold must be between 0 and 100")
		os.Exit(1)
	}

	return cfg
}

func testRunCmd(args []string) {
	cfg := parseTestRunFlags(args)
	apiURL := getAPIURL()
	apiKey := getAPIKey()

	// Step 1: Trigger the test run
	if !cfg.CI {
		fmt.Printf("Triggering test run for suite: %s\n", cfg.SuiteID)
	}

	runID, err := triggerTestRun(apiURL, apiKey, cfg.SuiteID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error triggering test run: %v\n", err)
		os.Exit(1)
	}

	if !cfg.CI {
		fmt.Printf("Test run started: %s\n", runID)
	}

	// Step 2: If CI mode, poll for completion
	if cfg.CI {
		run, err := pollForCompletion(apiURL, apiKey, runID, cfg.Timeout)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}

		// Step 3: Calculate pass rate and check threshold
		passRate := calculatePassRate(run)

		// Step 4: Output in requested format
		switch cfg.Format {
		case "json":
			outputJSON(run, passRate, cfg.Threshold)
		case "junit":
			outputJUnit(run)
		default:
			outputText(run, passRate, cfg.Threshold)
		}

		// Step 5: Exit with appropriate code
		if passRate >= cfg.Threshold {
			os.Exit(0)
		} else {
			os.Exit(1)
		}
	} else {
		// Interactive mode: just print the run ID
		fmt.Printf("\nTrack progress:\n  traceform test status %s\n", runID)
	}
}

// triggerTestRun sends POST to start a test run. Returns the run ID.
func triggerTestRun(apiURL, apiKey, suiteID string) (string, error) {
	url := fmt.Sprintf("%s/v1/test/suites/%s/run", apiURL, suiteID)
	req, err := http.NewRequest("POST", url, strings.NewReader("{}"))
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("calling API: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("API error (%d): %s", resp.StatusCode, string(body))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parsing response: %w", err)
	}

	if run, ok := result["run"].(map[string]interface{}); ok {
		if id, ok := run["id"].(string); ok {
			return id, nil
		}
	}

	// Fallback: check top-level "id"
	if id, ok := result["id"].(string); ok {
		return id, nil
	}

	return "", fmt.Errorf("no run ID in response: %s", string(body))
}

// testRunResult holds the parsed test run data.
type testRunResult struct {
	ID          string  `json:"id"`
	SuiteID     string  `json:"suite_id"`
	SuiteName   string  `json:"suite_name"`
	Status      string  `json:"status"`
	TotalCases  float64 `json:"total_cases"`
	PassedCases float64 `json:"passed_cases"`
	FailedCases float64 `json:"failed_cases"`
	ErrorCases  float64 `json:"error_cases"`
	AvgScore    float64 `json:"avg_score"`
	DurationMS  float64 `json:"duration_ms"`
	TotalCost   float64 `json:"total_cost_cents"`
	Results     []testCaseResult `json:"results"`
}

// testCaseResult holds individual test case results.
type testCaseResult struct {
	Name       string  `json:"name"`
	Status     string  `json:"status"`
	Score      float64 `json:"score"`
	DurationMS float64 `json:"duration_ms"`
	Error      string  `json:"error"`
	Expected   string  `json:"expected"`
	Actual     string  `json:"actual"`
}

// pollForCompletion polls the run status until it completes or times out.
func pollForCompletion(apiURL, apiKey, runID string, timeoutSec int) (*testRunResult, error) {
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	pollInterval := 5 * time.Second

	for {
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("timeout: test run %s did not complete within %d seconds", runID, timeoutSec)
		}

		run, err := fetchRunStatus(apiURL, apiKey, runID)
		if err != nil {
			return nil, err
		}

		switch run.Status {
		case "completed", "failed":
			return run, nil
		case "running", "pending", "queued":
			time.Sleep(pollInterval)
			continue
		default:
			return run, nil
		}
	}
}

// fetchRunStatus gets the current run status from the API.
func fetchRunStatus(apiURL, apiKey, runID string) (*testRunResult, error) {
	url := fmt.Sprintf("%s/v1/test/runs/%s", apiURL, runID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("calling API: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(body))
	}

	var run testRunResult
	if err := json.Unmarshal(body, &run); err != nil {
		// Try nested under "run" key
		var wrapped struct {
			Run testRunResult `json:"run"`
		}
		if err2 := json.Unmarshal(body, &wrapped); err2 != nil {
			return nil, fmt.Errorf("parsing response: %w", err)
		}
		run = wrapped.Run
	}

	return &run, nil
}

// calculatePassRate returns the pass rate as a percentage (0-100).
func calculatePassRate(run *testRunResult) float64 {
	if run.TotalCases == 0 {
		return 100
	}
	return (run.PassedCases / run.TotalCases) * 100
}

// outputText writes results in human-readable text format.
func outputText(run *testRunResult, passRate, threshold float64) {
	fmt.Printf("Test Run Results\n")
	fmt.Printf("================\n")
	fmt.Printf("  Run ID:      %s\n", run.ID)
	fmt.Printf("  Suite:       %s\n", run.SuiteName)
	fmt.Printf("  Status:      %s\n", run.Status)
	fmt.Printf("  Total Cases: %.0f\n", run.TotalCases)
	fmt.Printf("  Passed:      %.0f\n", run.PassedCases)
	fmt.Printf("  Failed:      %.0f\n", run.FailedCases)
	fmt.Printf("  Errors:      %.0f\n", run.ErrorCases)
	fmt.Printf("  Avg Score:   %.4f\n", run.AvgScore)
	fmt.Printf("  Duration:    %.0f ms\n", run.DurationMS)
	fmt.Printf("  Pass Rate:   %.1f%%\n", passRate)
	fmt.Printf("  Threshold:   %.1f%%\n", threshold)
	fmt.Println()

	if len(run.Results) > 0 {
		fmt.Printf("%-40s %-10s %-8s %-10s %s\n", "CASE", "STATUS", "SCORE", "DURATION", "ERROR")
		fmt.Println(repeatChar('-', 90))
		for _, r := range run.Results {
			errMsg := r.Error
			if len(errMsg) > 30 {
				errMsg = errMsg[:27] + "..."
			}
			fmt.Printf("%-40s %-10s %-8.4f %-10.0fms %s\n",
				truncate(r.Name, 40), r.Status, r.Score, r.DurationMS, errMsg)
		}
		fmt.Println()
	}

	if passRate >= threshold {
		fmt.Printf("PASS: %.1f%% >= %.1f%% threshold\n", passRate, threshold)
	} else {
		fmt.Printf("FAIL: %.1f%% < %.1f%% threshold\n", passRate, threshold)
	}
}

// outputJSON writes results as JSON to stdout.
func outputJSON(run *testRunResult, passRate, threshold float64) {
	output := struct {
		Run       *testRunResult `json:"run"`
		PassRate  float64        `json:"pass_rate"`
		Threshold float64        `json:"threshold"`
		GatePassed bool          `json:"gate_passed"`
	}{
		Run:        run,
		PassRate:   passRate,
		Threshold:  threshold,
		GatePassed: passRate >= threshold,
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(output); err != nil {
		fmt.Fprintf(os.Stderr, "Error encoding JSON: %v\n", err)
		os.Exit(1)
	}
}

// JUnit XML types for CI system integration.
type junitTestSuites struct {
	XMLName  xml.Name         `xml:"testsuites"`
	Name     string           `xml:"name,attr"`
	Tests    int              `xml:"tests,attr"`
	Failures int              `xml:"failures,attr"`
	Errors   int              `xml:"errors,attr"`
	Time     float64          `xml:"time,attr"`
	Suites   []junitTestSuite `xml:"testsuite"`
}

type junitTestSuite struct {
	Name     string          `xml:"name,attr"`
	Tests    int             `xml:"tests,attr"`
	Failures int             `xml:"failures,attr"`
	Errors   int             `xml:"errors,attr"`
	Time     float64         `xml:"time,attr"`
	Cases    []junitTestCase `xml:"testcase"`
}

type junitTestCase struct {
	Name    string        `xml:"name,attr"`
	Time    float64       `xml:"time,attr"`
	Failure *junitFailure `xml:"failure,omitempty"`
	Error   *junitError   `xml:"error,omitempty"`
}

type junitFailure struct {
	Message string `xml:"message,attr"`
	Text    string `xml:",chardata"`
}

type junitError struct {
	Message string `xml:"message,attr"`
	Text    string `xml:",chardata"`
}

// outputJUnit writes results as JUnit XML to stdout.
func outputJUnit(run *testRunResult) {
	totalTests := int(run.TotalCases)
	totalFailures := int(run.FailedCases)
	totalErrors := int(run.ErrorCases)
	totalTime := run.DurationMS / 1000.0

	suiteName := run.SuiteName
	if suiteName == "" {
		suiteName = run.SuiteID
	}
	if suiteName == "" {
		suiteName = "Traceform Test Suite"
	}

	cases := make([]junitTestCase, 0, len(run.Results))
	for _, r := range run.Results {
		tc := junitTestCase{
			Name: r.Name,
			Time: r.DurationMS / 1000.0,
		}

		switch r.Status {
		case "failed":
			msg := "Score below threshold"
			detail := fmt.Sprintf("Expected passing score, got %.4f", r.Score)
			if r.Expected != "" && r.Actual != "" {
				detail = fmt.Sprintf("Expected %s, got %s", r.Expected, r.Actual)
			}
			if r.Error != "" {
				detail = r.Error
			}
			tc.Failure = &junitFailure{
				Message: msg,
				Text:    detail,
			}
		case "error":
			msg := "Test case error"
			if r.Error != "" {
				msg = r.Error
			}
			tc.Error = &junitError{
				Message: msg,
				Text:    r.Error,
			}
		}

		cases = append(cases, tc)
	}

	// If no individual results, synthesize from summary counts
	if len(cases) == 0 && totalTests > 0 {
		for i := 0; i < int(run.PassedCases); i++ {
			cases = append(cases, junitTestCase{
				Name: fmt.Sprintf("Case %d", i+1),
				Time: 0,
			})
		}
		for i := 0; i < int(run.FailedCases); i++ {
			cases = append(cases, junitTestCase{
				Name: fmt.Sprintf("Failed Case %d", i+1),
				Time: 0,
				Failure: &junitFailure{
					Message: "Test case failed",
					Text:    "Score below threshold",
				},
			})
		}
		for i := 0; i < int(run.ErrorCases); i++ {
			cases = append(cases, junitTestCase{
				Name: fmt.Sprintf("Error Case %d", i+1),
				Time: 0,
				Error: &junitError{
					Message: "Test case error",
					Text:    "Execution error",
				},
			})
		}
	}

	suites := junitTestSuites{
		Name:     "Traceform",
		Tests:    totalTests,
		Failures: totalFailures,
		Errors:   totalErrors,
		Time:     totalTime,
		Suites: []junitTestSuite{
			{
				Name:     suiteName,
				Tests:    totalTests,
				Failures: totalFailures,
				Errors:   totalErrors,
				Time:     totalTime,
				Cases:    cases,
			},
		},
	}

	fmt.Println(`<?xml version="1.0" encoding="UTF-8"?>`)
	enc := xml.NewEncoder(os.Stdout)
	enc.Indent("", "  ")
	if err := enc.Encode(suites); err != nil {
		fmt.Fprintf(os.Stderr, "Error encoding JUnit XML: %v\n", err)
		os.Exit(1)
	}
	fmt.Println()
}

func testStatus(args []string) {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: traceform test status <run-id>")
		os.Exit(1)
	}

	runID := args[0]
	apiURL := getAPIURL()
	apiKey := getAPIKey()

	run, err := fetchRunStatus(apiURL, apiKey, runID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Test Run: %s\n", runID)
	fmt.Printf("  Status:      %s\n", run.Status)
	fmt.Printf("  Total Cases: %.0f\n", run.TotalCases)
	fmt.Printf("  Passed:      %.0f\n", run.PassedCases)
	fmt.Printf("  Failed:      %.0f\n", run.FailedCases)
	fmt.Printf("  Errors:      %.0f\n", run.ErrorCases)
	fmt.Printf("  Avg Score:   %.4f\n", run.AvgScore)
	fmt.Printf("  Duration:    %.0f ms\n", run.DurationMS)

	if run.TotalCases > 0 {
		passRate := (run.PassedCases / run.TotalCases) * 100
		fmt.Printf("  Pass Rate:   %.1f%%\n", passRate)
	}
}
