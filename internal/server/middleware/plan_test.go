package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
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

func TestRequireFeature_Allowed(t *testing.T) {
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

func TestRequireFeature_Denied(t *testing.T) {
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

func TestRequireFeature_SSO_EnterprisOnly(t *testing.T) {
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

func TestRequireFeature_DataExport_FreeBlocked(t *testing.T) {
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

func TestRequireFeature_DataExport_CloudAllowed(t *testing.T) {
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

func TestRequireFeature_UnknownPlanDefaultsToFree(t *testing.T) {
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
