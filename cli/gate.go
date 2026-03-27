package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// GateCommand implements the "traceform gate" quality gate subcommand.
// It runs a test suite and checks multiple gates (pass rate, cost, duration).
func GateCommand(args []string) {
	if len(args) == 0 {
		printGateHelp()
		os.Exit(0)
	}

	cfg := parseGateFlags(args)

	apiURL := getAPIURL()
	apiKey := getAPIKey()

	// Step 1: Trigger the test run
	fmt.Fprintf(os.Stderr, "Triggering test run for suite: %s\n", cfg.SuiteID)

	runID, err := triggerTestRun(apiURL, apiKey, cfg.SuiteID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error triggering test run: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "Test run started: %s\n", runID)
	fmt.Fprintf(os.Stderr, "Waiting for completion (timeout: %ds)...\n", cfg.Timeout)

	// Step 2: Poll for completion
	run, err := pollForCompletion(apiURL, apiKey, runID, cfg.Timeout)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Step 3: Evaluate gates
	gates := evaluateGates(run, cfg)

	// Step 4: Output results
	if cfg.Format == "json" {
		outputGateJSON(run, gates)
	} else {
		outputGateText(run, gates)
	}

	// Step 5: Exit based on gate results
	allPassed := true
	for _, g := range gates {
		if !g.Passed {
			allPassed = false
			break
		}
	}

	if allPassed {
		os.Exit(0)
	} else {
		os.Exit(1)
	}
}

func printGateHelp() {
	fmt.Println(`Usage: traceform gate [flags]

Run a test suite and check quality gates. Exits 0 if ALL gates pass, 1 if ANY gate fails.

Flags:
  --suite <id>            Test suite ID or name to run (required)
  --min-pass-rate <n>     Minimum pass rate percentage (0-100)
  --max-cost <n>          Maximum cost in cents for the test run
  --max-duration <n>      Maximum duration in seconds for the test run
  --timeout <n>           Max wait time in seconds for results (default 300)
  --format <fmt>          Output format: text (default), json

Global Flags:
  --api-key <key>         API key (or set TRACEFORM_API_KEY)
  --endpoint <url>        API endpoint (or set TRACEFORM_ENDPOINT, default http://localhost:8080)

Examples:
  # Check pass rate and cost
  traceform gate --suite my-suite --min-pass-rate 95 --max-cost 500

  # Check all gates
  traceform gate --suite my-suite --min-pass-rate 95 --max-cost 500 --max-duration 60

  # JSON output for programmatic consumption
  traceform gate --suite my-suite --min-pass-rate 90 --format json

  # With explicit credentials
  traceform gate --suite my-suite --min-pass-rate 95 --api-key sk_test --endpoint https://api.traceform.dev`)
}

// gateConfig holds parsed flags for the gate command.
type gateConfig struct {
	SuiteID     string
	MinPassRate float64
	MaxCost     float64
	MaxDuration float64
	Timeout     int
	Format      string

	// track which gates were requested
	HasMinPassRate bool
	HasMaxCost     bool
	HasMaxDuration bool
}

func parseGateFlags(args []string) gateConfig {
	cfg := gateConfig{
		Timeout:     300,
		Format:      "text",
		MinPassRate: -1,
		MaxCost:     -1,
		MaxDuration: -1,
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
		case "--min-pass-rate":
			if i+1 < len(args) {
				fmt.Sscanf(args[i+1], "%f", &cfg.MinPassRate)
				cfg.HasMinPassRate = true
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --min-pass-rate requires a value")
				os.Exit(1)
			}
		case "--max-cost":
			if i+1 < len(args) {
				fmt.Sscanf(args[i+1], "%f", &cfg.MaxCost)
				cfg.HasMaxCost = true
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --max-cost requires a value")
				os.Exit(1)
			}
		case "--max-duration":
			if i+1 < len(args) {
				fmt.Sscanf(args[i+1], "%f", &cfg.MaxDuration)
				cfg.HasMaxDuration = true
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --max-duration requires a value")
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
			printGateHelp()
			os.Exit(0)
		default:
			if !strings.HasPrefix(args[i], "--") && cfg.SuiteID == "" {
				cfg.SuiteID = args[i]
			} else {
				fmt.Fprintf(os.Stderr, "Unknown flag: %s\n", args[i])
				os.Exit(1)
			}
		}
	}

	if cfg.SuiteID == "" {
		fmt.Fprintln(os.Stderr, "Error: --suite is required")
		fmt.Fprintln(os.Stderr, "Run 'traceform gate --help' for usage.")
		os.Exit(1)
	}

	if !cfg.HasMinPassRate && !cfg.HasMaxCost && !cfg.HasMaxDuration {
		fmt.Fprintln(os.Stderr, "Error: at least one gate must be specified (--min-pass-rate, --max-cost, --max-duration)")
		os.Exit(1)
	}

	if cfg.Format != "text" && cfg.Format != "json" {
		fmt.Fprintf(os.Stderr, "Error: --format must be text or json (got %q)\n", cfg.Format)
		os.Exit(1)
	}

	return cfg
}

// gateResult holds the evaluation of a single quality gate.
type gateResult struct {
	Name      string  `json:"name"`
	Passed    bool    `json:"passed"`
	Threshold float64 `json:"threshold"`
	Actual    float64 `json:"actual"`
	Unit      string  `json:"unit"`
	Message   string  `json:"message"`
}

// evaluateGates checks all configured gates against the test run results.
func evaluateGates(run *testRunResult, cfg gateConfig) []gateResult {
	var gates []gateResult

	if cfg.HasMinPassRate {
		passRate := calculatePassRate(run)
		passed := passRate >= cfg.MinPassRate
		msg := fmt.Sprintf("%.1f%% >= %.1f%%", passRate, cfg.MinPassRate)
		if !passed {
			msg = fmt.Sprintf("%.1f%% < %.1f%%", passRate, cfg.MinPassRate)
		}
		gates = append(gates, gateResult{
			Name:      "min-pass-rate",
			Passed:    passed,
			Threshold: cfg.MinPassRate,
			Actual:    passRate,
			Unit:      "%",
			Message:   msg,
		})
	}

	if cfg.HasMaxCost {
		actualCost := run.TotalCost
		passed := actualCost <= cfg.MaxCost
		msg := fmt.Sprintf("%.0f cents <= %.0f cents", actualCost, cfg.MaxCost)
		if !passed {
			msg = fmt.Sprintf("%.0f cents > %.0f cents", actualCost, cfg.MaxCost)
		}
		gates = append(gates, gateResult{
			Name:      "max-cost",
			Passed:    passed,
			Threshold: cfg.MaxCost,
			Actual:    actualCost,
			Unit:      "cents",
			Message:   msg,
		})
	}

	if cfg.HasMaxDuration {
		actualDuration := run.DurationMS / 1000.0
		passed := actualDuration <= cfg.MaxDuration
		msg := fmt.Sprintf("%.1fs <= %.1fs", actualDuration, cfg.MaxDuration)
		if !passed {
			msg = fmt.Sprintf("%.1fs > %.1fs", actualDuration, cfg.MaxDuration)
		}
		gates = append(gates, gateResult{
			Name:      "max-duration",
			Passed:    passed,
			Threshold: cfg.MaxDuration,
			Actual:    actualDuration,
			Unit:      "seconds",
			Message:   msg,
		})
	}

	return gates
}

// outputGateText prints gate results in human-readable text.
func outputGateText(run *testRunResult, gates []gateResult) {
	fmt.Printf("Quality Gate Results\n")
	fmt.Printf("====================\n")
	fmt.Printf("  Run ID:      %s\n", run.ID)
	fmt.Printf("  Suite:       %s\n", run.SuiteName)
	fmt.Printf("  Status:      %s\n", run.Status)
	fmt.Printf("  Total Cases: %.0f\n", run.TotalCases)
	fmt.Printf("  Passed:      %.0f\n", run.PassedCases)
	fmt.Printf("  Failed:      %.0f\n", run.FailedCases)
	fmt.Println()

	allPassed := true
	fmt.Printf("Gates:\n")
	for _, g := range gates {
		status := "PASS"
		if !g.Passed {
			status = "FAIL"
			allPassed = false
		}
		fmt.Printf("  [%s] %-20s %s\n", status, g.Name, g.Message)
	}

	fmt.Println()
	if allPassed {
		fmt.Println("ALL GATES PASSED")
	} else {
		fmt.Println("GATE CHECK FAILED")
	}
}

// outputGateJSON prints gate results as JSON.
func outputGateJSON(run *testRunResult, gates []gateResult) {
	allPassed := true
	for _, g := range gates {
		if !g.Passed {
			allPassed = false
			break
		}
	}

	output := struct {
		Run       *testRunResult `json:"run"`
		Gates     []gateResult   `json:"gates"`
		AllPassed bool           `json:"all_passed"`
	}{
		Run:       run,
		Gates:     gates,
		AllPassed: allPassed,
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(output); err != nil {
		fmt.Fprintf(os.Stderr, "Error encoding JSON: %v\n", err)
		os.Exit(1)
	}
}
