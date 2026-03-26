package cli

import (
	"fmt"
	"os"
)

// GlobalConfig holds shared CLI configuration parsed from flags or environment.
type GlobalConfig struct {
	APIKey   string
	Endpoint string
}

// globalCfg is the shared config populated by ParseGlobalFlags.
var globalCfg GlobalConfig

// ParseGlobalFlags extracts --api-key and --endpoint from the arg list,
// returning the remaining args. Falls back to AGENTSTACK_API_KEY and
// AGENTSTACK_ENDPOINT environment variables.
func ParseGlobalFlags(args []string) []string {
	remaining := make([]string, 0, len(args))

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--api-key":
			if i+1 < len(args) {
				globalCfg.APIKey = args[i+1]
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --api-key requires a value")
				os.Exit(1)
			}
		case "--endpoint":
			if i+1 < len(args) {
				globalCfg.Endpoint = args[i+1]
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --endpoint requires a value")
				os.Exit(1)
			}
		default:
			remaining = append(remaining, args[i])
		}
	}

	// Fall back to environment variables
	if globalCfg.APIKey == "" {
		globalCfg.APIKey = os.Getenv("AGENTSTACK_API_KEY")
	}
	if globalCfg.Endpoint == "" {
		globalCfg.Endpoint = os.Getenv("AGENTSTACK_ENDPOINT")
	}
	if globalCfg.Endpoint == "" {
		globalCfg.Endpoint = "http://localhost:8080"
	}

	return remaining
}

// getAPIURL returns the configured API endpoint.
func getAPIURL() string {
	if globalCfg.Endpoint != "" {
		return globalCfg.Endpoint
	}
	url := os.Getenv("AGENTSTACK_ENDPOINT")
	if url == "" {
		url = os.Getenv("AGENTSTACK_API_URL")
	}
	if url == "" {
		url = "http://localhost:8080"
	}
	return url
}

// getAPIKey returns the configured API key.
func getAPIKey() string {
	if globalCfg.APIKey != "" {
		return globalCfg.APIKey
	}
	key := os.Getenv("AGENTSTACK_API_KEY")
	if key == "" {
		fmt.Fprintln(os.Stderr, "Warning: AGENTSTACK_API_KEY not set, using empty key")
	}
	return key
}

// repeatChar returns a string of n copies of ch.
func repeatChar(ch byte, n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = ch
	}
	return string(b)
}

// truncate shortens s to maxLen characters, adding "..." if truncated.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return s[:maxLen]
	}
	return s[:maxLen-3] + "..."
}
