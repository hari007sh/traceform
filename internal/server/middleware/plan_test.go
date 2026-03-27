package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/traceform/traceform/internal/license"
)

func TestGetOrgPlan_Default(t *testing.T) {
	ctx := context.Background()
	plan := GetOrgPlan(ctx)
	if plan != "free" {
		t.Errorf("expected default plan 'free', got %q", plan)
	}
}

func TestGetOrgPlan_FromContext(t *testing.T) {
	ctx := context.WithValue(context.Background(), OrgPlanKey, "enterprise")
	plan := GetOrgPlan(ctx)
	if plan != "enterprise" {
		t.Errorf("expected plan 'enterprise', got %q", plan)
	}
}

func TestPlanConfigs_AllPlansExist(t *testing.T) {
	expected := []string{"free", "cloud", "team", "enterprise"}
	for _, p := range expected {
		if _, ok := PlanConfigs[p]; !ok {
			t.Errorf("PlanConfigs missing plan %q", p)
		}
	}
}

func TestPlanConfigs_EnterpriseUnlimited(t *testing.T) {
	ent := PlanConfigs["enterprise"]
	if ent.MaxEventsPerMonth != -1 {
		t.Errorf("expected enterprise MaxEventsPerMonth to be -1 (unlimited), got %d", ent.MaxEventsPerMonth)
	}
	if ent.MaxTeamMembers != -1 {
		t.Errorf("expected enterprise MaxTeamMembers to be -1 (unlimited), got %d", ent.MaxTeamMembers)
	}
}

// --- Cloud mode tests (TRACEFORM_MODE=cloud) ---

func setCloudMode(t *testing.T) {
	t.Helper()
	os.Setenv("TRACEFORM_MODE", "cloud")
	t.Cleanup(func() { os.Unsetenv("TRACEFORM_MODE") })
}

func TestRequireFeature_Cloud_Allowed(t *testing.T) {
	setCloudMode(t)

	handler := RequireFeature("audit_log")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// cloud plan has audit_log enabled
	req := httptest.NewRequest("GET", "/test", nil)
	ctx := context.WithValue(req.Context(), OrgPlanKey, "cloud")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestRequireFeature_Cloud_Denied(t *testing.T) {
	setCloudMode(t)

	handler := RequireFeature("sso")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// free plan does NOT have sso
	req := httptest.NewRequest("GET", "/test", nil)
	ctx := context.WithValue(req.Context(), OrgPlanKey, "free")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
}

func TestRequireFeature_Cloud_SSO_EnterpriseOnly(t *testing.T) {
	setCloudMode(t)

	plans := []string{"free", "cloud", "team"}
	for _, plan := range plans {
		handler := RequireFeature("sso")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))

		req := httptest.NewRequest("GET", "/test", nil)
		ctx := context.WithValue(req.Context(), OrgPlanKey, plan)
		req = req.WithContext(ctx)

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusForbidden {
			t.Errorf("plan %q: expected 403 for SSO, got %d", plan, rr.Code)
		}
	}

	// enterprise should have SSO
	handler := RequireFeature("sso")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	ctx := context.WithValue(req.Context(), OrgPlanKey, "enterprise")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("enterprise: expected 200 for SSO, got %d", rr.Code)
	}
}

func TestRequireFeature_Cloud_DataExport_FreeBlocked(t *testing.T) {
	setCloudMode(t)

	handler := RequireFeature("data_export")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	ctx := context.WithValue(req.Context(), OrgPlanKey, "free")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 for data_export on free plan, got %d", rr.Code)
	}
}

func TestRequireFeature_Cloud_DataExport_CloudAllowed(t *testing.T) {
	setCloudMode(t)

	handler := RequireFeature("data_export")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	ctx := context.WithValue(req.Context(), OrgPlanKey, "cloud")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 for data_export on cloud plan, got %d", rr.Code)
	}
}

func TestRequireFeature_Cloud_UnknownPlanDefaultsToFree(t *testing.T) {
	setCloudMode(t)

	handler := RequireFeature("audit_log")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	ctx := context.WithValue(req.Context(), OrgPlanKey, "nonexistent_plan")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	// free plan doesn't have audit_log
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 for audit_log on unknown plan (defaults to free), got %d", rr.Code)
	}
}

// --- Self-hosted mode tests (default, no TRACEFORM_MODE set) ---

func setSelfHostedMode(t *testing.T) {
	t.Helper()
	os.Unsetenv("TRACEFORM_MODE")
	t.Cleanup(func() { os.Unsetenv("TRACEFORM_MODE") })
}

func TestRequireFeature_SelfHosted_CommunityDenied(t *testing.T) {
	setSelfHostedMode(t)

	handler := RequireFeature("audit_log")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Community license has no features
	lic := license.CommunityLicense()
	req := httptest.NewRequest("GET", "/test", nil)
	ctx := context.WithValue(req.Context(), LicenseKey, lic)
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 for audit_log on community license, got %d", rr.Code)
	}
}

func TestRequireFeature_SelfHosted_TeamAllowed(t *testing.T) {
	setSelfHostedMode(t)

	handler := RequireFeature("audit_log")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	lic := &license.License{
		Tier:     "team",
		Features: []string{"audit_log", "data_export", "error_groups", "budget_enforcement", "api_key_rotation"},
		Valid:    true,
	}
	req := httptest.NewRequest("GET", "/test", nil)
	ctx := context.WithValue(req.Context(), LicenseKey, lic)
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 for audit_log on team license, got %d", rr.Code)
	}
}

func TestRequireFeature_SelfHosted_TeamSSO_Denied(t *testing.T) {
	setSelfHostedMode(t)

	handler := RequireFeature("sso")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	lic := &license.License{
		Tier:     "team",
		Features: []string{"audit_log", "data_export"},
		Valid:    true,
	}
	req := httptest.NewRequest("GET", "/test", nil)
	ctx := context.WithValue(req.Context(), LicenseKey, lic)
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 for sso on team license, got %d", rr.Code)
	}
}

func TestRequireFeature_SelfHosted_EnterpriseAllFeatures(t *testing.T) {
	setSelfHostedMode(t)

	features := []string{"sso", "audit_log", "data_export", "custom_roles", "error_groups", "budget_enforcement", "api_key_rotation"}
	for _, feature := range features {
		handler := RequireFeature(feature)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))

		lic := &license.License{
			Tier:     "enterprise",
			Features: []string{}, // enterprise has all features implicitly
			Valid:    true,
		}
		req := httptest.NewRequest("GET", "/test", nil)
		ctx := context.WithValue(req.Context(), LicenseKey, lic)
		req = req.WithContext(ctx)

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200 for %s on enterprise license, got %d", feature, rr.Code)
		}
	}
}

func TestRequireFeature_SelfHosted_NoLicenseInContext(t *testing.T) {
	setSelfHostedMode(t)

	handler := RequireFeature("audit_log")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// No license in context at all
	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 when no license in context, got %d", rr.Code)
	}
}

func TestLicenseInjector(t *testing.T) {
	lic := &license.License{
		Tier:     "team",
		Org:      "Test Corp",
		Features: []string{"audit_log"},
		Valid:    true,
	}

	var extractedLic *license.License
	handler := LicenseInjector(lic)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		extractedLic = GetLicenseFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if extractedLic == nil {
		t.Fatal("expected license in context, got nil")
	}
	if extractedLic.Tier != "team" {
		t.Errorf("expected tier team, got %q", extractedLic.Tier)
	}
	if extractedLic.Org != "Test Corp" {
		t.Errorf("expected org 'Test Corp', got %q", extractedLic.Org)
	}
}

func TestGetLicenseFromContext_Nil(t *testing.T) {
	ctx := context.Background()
	lic := GetLicenseFromContext(ctx)
	if lic != nil {
		t.Errorf("expected nil license from empty context, got %+v", lic)
	}
}
