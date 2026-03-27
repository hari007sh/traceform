package billing

import (
	"context"
	"testing"
)

func TestNewMeter_NilRedis(t *testing.T) {
	m := NewMeter(nil)
	if m == nil {
		t.Fatal("expected non-nil meter")
	}
}

func TestMeter_NilRedis_IncrementEvents(t *testing.T) {
	m := NewMeter(nil)
	// Should not panic with nil redis
	m.IncrementEvents(context.Background(), "org-123", 10)
}

func TestMeter_NilRedis_GetMonthlyUsage(t *testing.T) {
	m := NewMeter(nil)
	usage, err := m.GetMonthlyUsage(context.Background(), "org-123")
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
	if usage != 0 {
		t.Errorf("expected 0 usage with nil redis, got %d", usage)
	}
}

func TestMeter_NilRedis_CheckLimit(t *testing.T) {
	m := NewMeter(nil)
	ok, usage, limit := m.CheckLimit(context.Background(), "org-123", "free")
	if !ok {
		t.Error("expected within limit for nil redis")
	}
	if usage != 0 {
		t.Errorf("expected 0 usage, got %d", usage)
	}
	if limit != 10000 {
		t.Errorf("expected 10000 limit for free plan, got %d", limit)
	}
}

func TestMeter_CheckLimit_EnterpriseUnlimited(t *testing.T) {
	m := NewMeter(nil)
	ok, _, limit := m.CheckLimit(context.Background(), "org-123", "enterprise")
	if !ok {
		t.Error("expected within limit for enterprise (unlimited)")
	}
	if limit != -1 {
		t.Errorf("expected -1 limit for enterprise, got %d", limit)
	}
}

func TestMeter_CheckLimit_UnknownPlanDefaultsToFree(t *testing.T) {
	m := NewMeter(nil)
	ok, _, limit := m.CheckLimit(context.Background(), "org-123", "nonexistent")
	if !ok {
		t.Error("expected within limit with nil redis (0 usage)")
	}
	if limit != 10000 {
		t.Errorf("expected 10000 limit (free default), got %d", limit)
	}
}
