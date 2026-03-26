package main

import (
	"fmt"
	"os"

	"github.com/agentstack/agentstack/cli"
)

const version = "0.2.0"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(0)
	}

	// Check for top-level flags before commands
	switch os.Args[1] {
	case "--help", "-h", "help":
		printUsage()
		os.Exit(0)
	case "--version", "-v", "version":
		fmt.Printf("agentstack %s\n", version)
		os.Exit(0)
	}

	// Parse global flags (--api-key, --endpoint) from all args,
	// which also strips them out so we can find the command.
	allArgs := cli.ParseGlobalFlags(os.Args[1:])

	if len(allArgs) == 0 {
		printUsage()
		os.Exit(0)
	}

	command := allArgs[0]
	remaining := allArgs[1:]

	switch command {
	case "test":
		cli.TestCommand(remaining)
	case "cost":
		cli.CostCommand(remaining)
	case "gate":
		cli.GateCommand(remaining)
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", command)
		fmt.Fprintln(os.Stderr, "Run 'agentstack --help' for usage.")
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Printf(`AgentStack CLI v%s — AI agent production platform

Usage: agentstack <command> [flags]

Commands:
  test       Run test suites and view results
  cost       View cost analytics and budget policies
  gate       Run quality gates (CI/CD integration)
  version    Print version information

Global Flags:
  --api-key <key>     API key (or set AGENTSTACK_API_KEY env var)
  --endpoint <url>    API endpoint (or set AGENTSTACK_ENDPOINT env var)
                      Default: http://localhost:8080

Examples:
  # Run tests in CI mode with JUnit output
  agentstack test run --suite my-suite --ci --threshold 95 --format junit > results.xml

  # Quality gate check for CI/CD pipelines
  agentstack gate --suite my-suite --min-pass-rate 95 --max-cost 500

  # View cost summary as JSON
  agentstack cost summary --period 7d --format json

  # Use explicit API key and endpoint
  agentstack --api-key sk_test123 --endpoint https://api.agentstack.dev test run --suite my-suite

Run 'agentstack <command> --help' for more information on a command.
`, version)
}
