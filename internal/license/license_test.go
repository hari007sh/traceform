package license

import (
	"testing"
	"time"
)

func TestCommunityLicense(t *testing.T) {
	lic := CommunityLicense()
	if lic.Tier != "community" {
		t.Errorf("expected tier community, got %q", lic.Tier)
	}
	if lic.MaxMembers != 3 {
		t.Errorf("expected max_members 3, got %d", lic.MaxMembers)
	}
	if lic.RetentionDays != 7 {
		t.Errorf("expected retention_days 7, got %d", lic.RetentionDays)
	}
	if !lic.Valid {
		t.Error("expected valid to be true")
	}
	if len(lic.Features) != 0 {
		t.Errorf("expected no features, got %v", lic.Features)
	}
}

func TestValidate_EmptyKey(t *testing.T) {
	lic, err := Validate("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if lic.Tier != "community" {
		t.Errorf("expected community tier for empty key, got %q", lic.Tier)
	}
	if !lic.Valid {
		t.Error("expected valid to be true for empty key")
	}
}

func TestValidate_InvalidKey(t *testing.T) {
	lic, err := Validate("not-a-valid-jwt")
	if err == nil {
		t.Fatal("expected error for invalid key")
	}
	if lic.Tier != "community" {
		t.Errorf("expected community fallback, got %q", lic.Tier)
	}
}

func TestGenerateAndValidate_TeamKey(t *testing.T) {
	features := []string{"audit_log", "data_export", "error_groups", "budget_enforcement", "api_key_rotation"}
	key, err := GenerateKey("team", "Acme Inc", 25, 90, features, 24*time.Hour)
	if err != nil {
		t.Fatalf("generate error: %v", err)
	}
	if key == "" {
		t.Fatal("expected non-empty key")
	}

	lic, err := Validate(key)
	if err != nil {
		t.Fatalf("validate error: %v", err)
	}
	if lic.Tier != "team" {
		t.Errorf("expected tier team, got %q", lic.Tier)
	}
	if lic.Org != "Acme Inc" {
		t.Errorf("expected org 'Acme Inc', got %q", lic.Org)
	}
	if lic.MaxMembers != 25 {
		t.Errorf("expected max_members 25, got %d", lic.MaxMembers)
	}
	if lic.RetentionDays != 90 {
		t.Errorf("expected retention_days 90, got %d", lic.RetentionDays)
	}
	if !lic.Valid {
		t.Error("expected valid to be true")
	}
	if len(lic.Features) != 5 {
		t.Errorf("expected 5 features, got %d", len(lic.Features))
	}

	// Check feature gate
	for _, f := range features {
		if !lic.HasFeature(f) {
			t.Errorf("expected feature %q to be present", f)
		}
	}
	if lic.HasFeature("sso") {
		t.Error("team license should not have sso")
	}
	if lic.HasFeature("custom_roles") {
		t.Error("team license should not have custom_roles")
	}
}

func TestGenerateAndValidate_EnterpriseKey(t *testing.T) {
	features := []string{"sso", "custom_roles", "audit_log", "data_export"}
	key, err := GenerateKey("enterprise", "BigCorp", -1, 365, features, 365*24*time.Hour)
	if err != nil {
		t.Fatalf("generate error: %v", err)
	}

	lic, err := Validate(key)
	if err != nil {
		t.Fatalf("validate error: %v", err)
	}
	if lic.Tier != "enterprise" {
		t.Errorf("expected tier enterprise, got %q", lic.Tier)
	}

	// Enterprise has all features implicitly
	if !lic.HasFeature("sso") {
		t.Error("enterprise should have sso")
	}
	if !lic.HasFeature("custom_roles") {
		t.Error("enterprise should have custom_roles")
	}
	if !lic.HasFeature("anything_at_all") {
		t.Error("enterprise should have any feature")
	}
}

func TestValidate_ExpiredKey(t *testing.T) {
	key, err := GenerateKey("team", "Expired Corp", 25, 90,
		[]string{"audit_log"}, -24*time.Hour) // expired 24h ago
	if err != nil {
		t.Fatalf("generate error: %v", err)
	}

	lic, err := Validate(key)
	if err == nil {
		t.Fatal("expected error for expired key")
	}
	if lic.Tier != "community" {
		t.Errorf("expected community fallback for expired key, got %q", lic.Tier)
	}
}

func TestHasFeature_CommunityNoFeatures(t *testing.T) {
	lic := CommunityLicense()
	features := []string{"sso", "audit_log", "data_export", "error_groups", "budget_enforcement", "api_key_rotation", "custom_roles"}
	for _, f := range features {
		if lic.HasFeature(f) {
			t.Errorf("community license should not have feature %q", f)
		}
	}
}

func TestValidate_TamperedKey(t *testing.T) {
	key, err := GenerateKey("team", "Test", 25, 90, []string{"audit_log"}, 24*time.Hour)
	if err != nil {
		t.Fatalf("generate error: %v", err)
	}

	// Tamper with the key by flipping a character in the signature
	tampered := key[:len(key)-2] + "XX"
	lic, err := Validate(tampered)
	if err == nil {
		t.Fatal("expected error for tampered key")
	}
	if lic.Tier != "community" {
		t.Errorf("expected community fallback for tampered key, got %q", lic.Tier)
	}
}

func TestValidate_FeaturesNeverNil(t *testing.T) {
	// Generate a key with no features
	key, err := GenerateKey("team", "Test", 10, 30, []string{}, 24*time.Hour)
	if err != nil {
		t.Fatalf("generate error: %v", err)
	}

	lic, err := Validate(key)
	if err != nil {
		t.Fatalf("validate error: %v", err)
	}
	if lic.Features == nil {
		t.Error("features should never be nil, expected empty slice")
	}
}
