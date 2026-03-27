package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// CostCommand handles all "traceform cost" subcommands.
func CostCommand(args []string) {
	if len(args) == 0 {
		printCostHelp()
		os.Exit(0)
	}

	switch args[0] {
	case "summary":
		costSummaryCmd(args[1:])
	case "budgets":
		costBudgetsCmd(args[1:])
	case "help", "--help", "-h":
		printCostHelp()
		os.Exit(0)
	default:
		fmt.Fprintf(os.Stderr, "Unknown cost command: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Run 'traceform cost --help' for usage.")
		os.Exit(1)
	}
}

func printCostHelp() {
	fmt.Println(`Usage: traceform cost <command> [flags]

Commands:
  summary    Show cost summary
  budgets    List budget policies with utilization

Summary Flags:
  --period <duration>    Time period: 1d, 7d, 30d, 90d (default: 7d)
  --format <fmt>         Output format: text (default), json

Global Flags:
  --api-key <key>        API key (or set TRACEFORM_API_KEY)
  --endpoint <url>       API endpoint (or set TRACEFORM_ENDPOINT, default http://localhost:8080)

Examples:
  # View 7-day cost summary
  traceform cost summary

  # View 30-day summary as JSON
  traceform cost summary --period 30d --format json

  # List budget policies
  traceform cost budgets

  # JSON output for scripts
  traceform cost budgets --format json`)
}

// costSummaryConfig holds parsed flags for the cost summary command.
type costSummaryConfig struct {
	Period string
	Format string
}

func parseCostSummaryFlags(args []string) costSummaryConfig {
	cfg := costSummaryConfig{
		Period: "7d",
		Format: "text",
	}

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--period":
			if i+1 < len(args) {
				cfg.Period = args[i+1]
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --period requires a value")
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
			printCostHelp()
			os.Exit(0)
		default:
			if !strings.HasPrefix(args[i], "--") {
				// Ignore positional args
			} else {
				fmt.Fprintf(os.Stderr, "Unknown flag: %s\n", args[i])
				os.Exit(1)
			}
		}
	}

	if cfg.Format != "text" && cfg.Format != "json" {
		fmt.Fprintf(os.Stderr, "Error: --format must be text or json (got %q)\n", cfg.Format)
		os.Exit(1)
	}

	return cfg
}

func costSummaryCmd(args []string) {
	cfg := parseCostSummaryFlags(args)
	apiURL := getAPIURL()
	apiKey := getAPIKey()

	url := fmt.Sprintf("%s/v1/cost/analytics/summary?period=%s", apiURL, cfg.Period)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating request: %v\n", err)
		os.Exit(1)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error calling API: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		fmt.Fprintf(os.Stderr, "API error (%d): %s\n", resp.StatusCode, string(body))
		os.Exit(1)
	}

	if cfg.Format == "json" {
		// Pass through raw JSON
		fmt.Println(string(body))
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing response: %v\n", err)
		os.Exit(1)
	}

	if summary, ok := result["summary"].(map[string]interface{}); ok {
		totalCents, _ := summary["total_spend_cents"].(float64)
		totalEvents, _ := summary["total_events"].(float64)
		uniqueModels, _ := summary["unique_models"].(float64)
		uniqueAgents, _ := summary["unique_agents"].(float64)
		avgPerSession, _ := summary["avg_cost_per_session_cents"].(float64)

		fmt.Printf("Cost Summary (period: %s)\n", cfg.Period)
		fmt.Printf("==========================\n")
		fmt.Printf("  Total Spend:         $%.2f\n", totalCents/100)
		fmt.Printf("  Total Events:        %.0f\n", totalEvents)
		fmt.Printf("  Avg Cost/Session:    $%.2f\n", avgPerSession/100)
		fmt.Printf("  Unique Models:       %.0f\n", uniqueModels)
		fmt.Printf("  Unique Agents:       %.0f\n", uniqueAgents)
	} else {
		fmt.Printf("Response: %s\n", string(body))
	}
}

// costBudgetsConfig holds parsed flags for the cost budgets command.
type costBudgetsConfig struct {
	Format string
}

func parseCostBudgetsFlags(args []string) costBudgetsConfig {
	cfg := costBudgetsConfig{
		Format: "text",
	}

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--format":
			if i+1 < len(args) {
				cfg.Format = args[i+1]
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --format requires a value")
				os.Exit(1)
			}
		case "--help", "-h":
			printCostHelp()
			os.Exit(0)
		default:
			if strings.HasPrefix(args[i], "--") {
				fmt.Fprintf(os.Stderr, "Unknown flag: %s\n", args[i])
				os.Exit(1)
			}
		}
	}

	return cfg
}

func costBudgetsCmd(args []string) {
	cfg := parseCostBudgetsFlags(args)
	apiURL := getAPIURL()
	apiKey := getAPIKey()

	url := fmt.Sprintf("%s/v1/cost/budgets", apiURL)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating request: %v\n", err)
		os.Exit(1)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error calling API: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		fmt.Fprintf(os.Stderr, "API error (%d): %s\n", resp.StatusCode, string(body))
		os.Exit(1)
	}

	if cfg.Format == "json" {
		fmt.Println(string(body))
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing response: %v\n", err)
		os.Exit(1)
	}

	budgets, ok := result["budgets"].([]interface{})
	if !ok || len(budgets) == 0 {
		fmt.Println("No budget policies found.")
		return
	}

	fmt.Printf("Budget Policies\n")
	fmt.Printf("%-36s %-20s %-10s %-12s %-12s %s\n", "ID", "Name", "Scope", "Limit", "Spent", "Utilization")
	fmt.Println(repeatChar('-', 110))

	for _, b := range budgets {
		budget, ok := b.(map[string]interface{})
		if !ok {
			continue
		}

		id, _ := budget["id"].(string)
		name, _ := budget["name"].(string)
		scope, _ := budget["scope"].(string)
		limitCents, _ := budget["limit_cents"].(float64)
		spendCents, _ := budget["current_spend_cents"].(float64)

		utilization := 0.0
		if limitCents > 0 {
			utilization = (spendCents / limitCents) * 100
		}

		fmt.Printf("%-36s %-20s %-10s $%-11.2f $%-11.2f %.1f%%\n",
			id, truncate(name, 20), scope,
			limitCents/100, spendCents/100, utilization)
	}
}
