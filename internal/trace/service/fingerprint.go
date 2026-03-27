package service

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
)

var (
	// Patterns to normalize before fingerprinting
	uuidPattern      = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
	numberPattern    = regexp.MustCompile(`\b\d+\.?\d*\b`)
	hexPattern       = regexp.MustCompile(`0x[0-9a-fA-F]+`)
	pathPattern      = regexp.MustCompile(`/[\w\-./]+\.\w+:\d+`)
	timestampPattern = regexp.MustCompile(`\d{4}-\d{2}-\d{2}[tT ]\d{2}:\d{2}:\d{2}`)
	ipPattern        = regexp.MustCompile(`\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}`)
	quotedPattern    = regexp.MustCompile(`"[^"]*"`)
)

// Fingerprint computes a stable hash for an error message by normalizing out
// variable parts (UUIDs, numbers, timestamps, IPs, file paths, quoted strings)
// so that semantically identical errors produce the same fingerprint.
func Fingerprint(errorMsg string) string {
	if errorMsg == "" {
		return ""
	}
	normalized := normalizeError(errorMsg)
	hash := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(hash[:8]) // First 8 bytes = 16 hex chars
}

// normalizeError strips variable parts from an error message so that
// semantically identical errors collapse to the same normalized form.
func normalizeError(msg string) string {
	s := strings.ToLower(msg)
	s = uuidPattern.ReplaceAllString(s, "<UUID>")
	s = timestampPattern.ReplaceAllString(s, "<TS>")
	s = ipPattern.ReplaceAllString(s, "<IP>")
	s = hexPattern.ReplaceAllString(s, "<HEX>")
	s = pathPattern.ReplaceAllString(s, "<PATH>")
	s = quotedPattern.ReplaceAllString(s, "<STR>")
	s = numberPattern.ReplaceAllString(s, "<N>")
	s = strings.Join(strings.Fields(s), " ")
	return s
}
