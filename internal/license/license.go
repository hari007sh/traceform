package license

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// signingKey is the HMAC-SHA256 key used to verify license tokens.
// In production, this would be an RSA public key embedded at build time.
var signingKey = []byte("traceform-license-signing-key-2026")

// License represents a validated Traceform license.
type License struct {
	Tier          string   `json:"tier"`
	Org           string   `json:"org"`
	MaxMembers    int      `json:"max_members"`
	RetentionDays int      `json:"retention_days"`
	Features      []string `json:"features"`
	ExpiresAt     time.Time `json:"expires_at"`
	Valid         bool     `json:"valid"`
}

// CommunityLicense returns the default free license (no key required).
func CommunityLicense() *License {
	return &License{
		Tier:          "community",
		Org:           "",
		MaxMembers:    3,
		RetentionDays: 7,
		Features:      []string{},
		Valid:         true,
	}
}

// Validate parses and validates a license key JWT. If key is empty, a
// CommunityLicense is returned. The validation is fully offline -- no
// network calls are made.
func Validate(key string) (*License, error) {
	if key == "" {
		return CommunityLicense(), nil
	}

	token, err := jwt.Parse(key, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return signingKey, nil
	})
	if err != nil || !token.Valid {
		return CommunityLicense(), fmt.Errorf("invalid license key: %v", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return CommunityLicense(), fmt.Errorf("invalid license claims")
	}

	lic := &License{
		Tier:          getString(claims, "tier", "community"),
		Org:           getString(claims, "org", ""),
		MaxMembers:    getInt(claims, "max_members", 3),
		RetentionDays: getInt(claims, "retention_days", 7),
		Valid:         true,
	}

	if features, ok := claims["features"].([]interface{}); ok {
		for _, f := range features {
			if s, ok := f.(string); ok {
				lic.Features = append(lic.Features, s)
			}
		}
	}
	// Ensure Features is never nil for consistent JSON serialization.
	if lic.Features == nil {
		lic.Features = []string{}
	}

	if exp, err := claims.GetExpirationTime(); err == nil && exp != nil {
		lic.ExpiresAt = exp.Time
		if time.Now().After(lic.ExpiresAt) {
			return CommunityLicense(), fmt.Errorf("license expired on %s", lic.ExpiresAt.Format(time.RFC3339))
		}
	}

	return lic, nil
}

// HasFeature checks if the license includes a specific feature.
// Enterprise licenses implicitly include every feature.
func (l *License) HasFeature(feature string) bool {
	if l.Tier == "enterprise" {
		return true
	}
	for _, f := range l.Features {
		if f == feature {
			return true
		}
	}
	return false
}

// GenerateKey creates a signed license key JWT for the given parameters.
// This is used for development/testing and by the CLI generate command.
func GenerateKey(tier, org string, maxMembers, retentionDays int, features []string, expiry time.Duration) (string, error) {
	claims := jwt.MapClaims{
		"tier":           tier,
		"org":            org,
		"max_members":    maxMembers,
		"retention_days": retentionDays,
		"features":       features,
		"iss":            "traceform",
		"exp":            time.Now().Add(expiry).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(signingKey)
}

// --- helpers ---

func getString(claims jwt.MapClaims, key, fallback string) string {
	if v, ok := claims[key].(string); ok {
		return v
	}
	return fallback
}

func getInt(claims jwt.MapClaims, key string, fallback int) int {
	if v, ok := claims[key].(float64); ok {
		return int(v)
	}
	return fallback
}
