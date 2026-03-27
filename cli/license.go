package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/traceform/traceform/internal/license"
)

// LicenseCommand handles all "traceform license" subcommands.
func LicenseCommand(args []string) {
	if len(args) == 0 {
		printLicenseHelp()
		os.Exit(0)
	}

	switch args[0] {
	case "generate":
		licenseGenerateCmd(args[1:])
	case "validate":
		licenseValidateCmd(args[1:])
	case "info":
		licenseInfoCmd(args[1:])
	case "help", "--help", "-h":
		printLicenseHelp()
		os.Exit(0)
	default:
		fmt.Fprintf(os.Stderr, "Unknown license command: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Run 'traceform license --help' for usage.")
		os.Exit(1)
	}
}

func printLicenseHelp() {
	fmt.Println(`Usage: traceform license <command> [flags]

Commands:
  generate   Generate a new license key (for development/admin use)
  validate   Validate a license key and display its contents
  info       Show current license from TRACEFORM_LICENSE_KEY env var

Generate Flags:
  --tier <tier>          License tier: community, team, enterprise (required)
  --org <name>           Organization name (required)
  --members <n>          Maximum team members (default: 3)
  --retention <days>     Data retention in days (default: 7)
  --features <list>      Comma-separated feature list
  --expiry <duration>    Expiry duration: 30d, 90d, 365d (default: 365d)

Validate Flags:
  <key>                  The license key to validate (positional argument)

Info Flags:
  --format <fmt>         Output format: text (default), json

Available Features:
  sso, audit_log, data_export, error_groups,
  budget_enforcement, api_key_rotation, custom_roles

Examples:
  # Generate a Team license
  traceform license generate --tier team --org "Acme Inc" --members 25 --retention 90 --expiry 365d

  # Generate an Enterprise license
  traceform license generate --tier enterprise --org "BigCorp" --members -1 --retention 365 \
    --features sso,custom_roles,audit_log,data_export,error_groups,budget_enforcement,api_key_rotation

  # Validate a key
  traceform license validate eyJhbGciOiJIUzI1NiIs...

  # Show current license
  traceform license info
  traceform license info --format json`)
}

// licenseGenConfig holds parsed flags for the license generate command.
type licenseGenConfig struct {
	Tier          string
	Org           string
	MaxMembers    int
	RetentionDays int
	Features      []string
	Expiry        time.Duration
}

func parseLicenseGenFlags(args []string) licenseGenConfig {
	cfg := licenseGenConfig{
		MaxMembers:    3,
		RetentionDays: 7,
		Expiry:        365 * 24 * time.Hour,
	}

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--tier":
			if i+1 < len(args) {
				cfg.Tier = args[i+1]
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --tier requires a value")
				os.Exit(1)
			}
		case "--org":
			if i+1 < len(args) {
				cfg.Org = args[i+1]
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --org requires a value")
				os.Exit(1)
			}
		case "--members":
			if i+1 < len(args) {
				n, err := strconv.Atoi(args[i+1])
				if err != nil {
					fmt.Fprintf(os.Stderr, "Error: --members must be an integer: %v\n", err)
					os.Exit(1)
				}
				cfg.MaxMembers = n
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --members requires a value")
				os.Exit(1)
			}
		case "--retention":
			if i+1 < len(args) {
				n, err := strconv.Atoi(args[i+1])
				if err != nil {
					fmt.Fprintf(os.Stderr, "Error: --retention must be an integer: %v\n", err)
					os.Exit(1)
				}
				cfg.RetentionDays = n
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --retention requires a value")
				os.Exit(1)
			}
		case "--features":
			if i+1 < len(args) {
				parts := strings.Split(args[i+1], ",")
				for _, p := range parts {
					p = strings.TrimSpace(p)
					if p != "" {
						cfg.Features = append(cfg.Features, p)
					}
				}
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --features requires a value")
				os.Exit(1)
			}
		case "--expiry":
			if i+1 < len(args) {
				d, err := parseDuration(args[i+1])
				if err != nil {
					fmt.Fprintf(os.Stderr, "Error: invalid --expiry: %v\n", err)
					os.Exit(1)
				}
				cfg.Expiry = d
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --expiry requires a value")
				os.Exit(1)
			}
		case "--help", "-h":
			printLicenseHelp()
			os.Exit(0)
		default:
			fmt.Fprintf(os.Stderr, "Unknown flag: %s\n", args[i])
			os.Exit(1)
		}
	}

	if cfg.Tier == "" {
		fmt.Fprintln(os.Stderr, "Error: --tier is required")
		os.Exit(1)
	}
	if cfg.Tier != "community" && cfg.Tier != "team" && cfg.Tier != "enterprise" {
		fmt.Fprintf(os.Stderr, "Error: --tier must be community, team, or enterprise (got %q)\n", cfg.Tier)
		os.Exit(1)
	}
	if cfg.Org == "" {
		fmt.Fprintln(os.Stderr, "Error: --org is required")
		os.Exit(1)
	}

	// Apply default features based on tier if none specified
	if len(cfg.Features) == 0 {
		switch cfg.Tier {
		case "team":
			cfg.Features = []string{"audit_log", "data_export", "error_groups", "budget_enforcement", "api_key_rotation"}
			cfg.MaxMembers = max(cfg.MaxMembers, 25)
			cfg.RetentionDays = max(cfg.RetentionDays, 90)
		case "enterprise":
			cfg.Features = []string{"sso", "custom_roles", "audit_log", "data_export", "error_groups", "budget_enforcement", "api_key_rotation"}
			if cfg.MaxMembers <= 0 {
				cfg.MaxMembers = -1 // unlimited
			}
			cfg.RetentionDays = max(cfg.RetentionDays, 365)
		}
	}

	return cfg
}

func licenseGenerateCmd(args []string) {
	cfg := parseLicenseGenFlags(args)

	key, err := license.GenerateKey(cfg.Tier, cfg.Org, cfg.MaxMembers, cfg.RetentionDays, cfg.Features, cfg.Expiry)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error generating license key: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "License Key Generated\n")
	fmt.Fprintf(os.Stderr, "=====================\n")
	fmt.Fprintf(os.Stderr, "  Tier:       %s\n", cfg.Tier)
	fmt.Fprintf(os.Stderr, "  Org:        %s\n", cfg.Org)
	fmt.Fprintf(os.Stderr, "  Members:    %d\n", cfg.MaxMembers)
	fmt.Fprintf(os.Stderr, "  Retention:  %d days\n", cfg.RetentionDays)
	fmt.Fprintf(os.Stderr, "  Features:   %s\n", strings.Join(cfg.Features, ", "))
	fmt.Fprintf(os.Stderr, "  Expires:    %s\n", time.Now().Add(cfg.Expiry).Format("2006-01-02"))
	fmt.Fprintf(os.Stderr, "\n")

	// Print the key to stdout so it can be piped/captured
	fmt.Println(key)
}

func licenseValidateCmd(args []string) {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: traceform license validate <key>")
		os.Exit(1)
	}

	key := args[0]
	lic, err := license.Validate(key)
	if err != nil {
		fmt.Fprintf(os.Stderr, "INVALID: %v\n", err)
		fmt.Fprintf(os.Stderr, "Falling back to Community edition.\n")
	} else {
		fmt.Fprintf(os.Stderr, "VALID\n")
	}
	fmt.Fprintf(os.Stderr, "\n")

	printLicenseInfo(lic)
}

func licenseInfoCmd(args []string) {
	format := "text"
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--format":
			if i+1 < len(args) {
				format = args[i+1]
				i++
			} else {
				fmt.Fprintln(os.Stderr, "Error: --format requires a value")
				os.Exit(1)
			}
		case "--help", "-h":
			printLicenseHelp()
			os.Exit(0)
		}
	}

	key := os.Getenv("TRACEFORM_LICENSE_KEY")
	lic, err := license.Validate(key)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: %v\n", err)
	}

	mode := os.Getenv("TRACEFORM_MODE")
	if mode == "" {
		mode = "self-hosted"
	}

	if format == "json" {
		output := struct {
			Tier          string   `json:"tier"`
			Org           string   `json:"org"`
			MaxMembers    int      `json:"max_members"`
			RetentionDays int      `json:"retention_days"`
			Features      []string `json:"features"`
			ExpiresAt     *string  `json:"expires_at"`
			Mode          string   `json:"mode"`
			Valid         bool     `json:"valid"`
		}{
			Tier:          lic.Tier,
			Org:           lic.Org,
			MaxMembers:    lic.MaxMembers,
			RetentionDays: lic.RetentionDays,
			Features:      lic.Features,
			Mode:          mode,
			Valid:         lic.Valid,
		}
		if !lic.ExpiresAt.IsZero() {
			s := lic.ExpiresAt.Format(time.RFC3339)
			output.ExpiresAt = &s
		}

		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(output); err != nil {
			fmt.Fprintf(os.Stderr, "Error encoding JSON: %v\n", err)
			os.Exit(1)
		}
	} else {
		printLicenseInfo(lic)
		fmt.Printf("  Mode:       %s\n", mode)
	}
}

func printLicenseInfo(lic *license.License) {
	fmt.Printf("License Info\n")
	fmt.Printf("============\n")
	fmt.Printf("  Tier:       %s\n", lic.Tier)
	fmt.Printf("  Org:        %s\n", lic.Org)
	fmt.Printf("  Members:    %d\n", lic.MaxMembers)
	fmt.Printf("  Retention:  %d days\n", lic.RetentionDays)
	if len(lic.Features) > 0 {
		fmt.Printf("  Features:   %s\n", strings.Join(lic.Features, ", "))
	} else {
		fmt.Printf("  Features:   (none)\n")
	}
	if !lic.ExpiresAt.IsZero() {
		fmt.Printf("  Expires:    %s\n", lic.ExpiresAt.Format("2006-01-02 15:04:05 MST"))
	} else {
		fmt.Printf("  Expires:    (never)\n")
	}
	fmt.Printf("  Valid:      %v\n", lic.Valid)
}

// parseDuration parses human-friendly durations like "30d", "90d", "365d".
func parseDuration(s string) (time.Duration, error) {
	if strings.HasSuffix(s, "d") {
		numStr := strings.TrimSuffix(s, "d")
		days, err := strconv.Atoi(numStr)
		if err != nil {
			return 0, fmt.Errorf("invalid day count: %s", numStr)
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	// Fall back to Go's time.ParseDuration for h, m, s
	return time.ParseDuration(s)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
