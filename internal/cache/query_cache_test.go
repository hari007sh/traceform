package cache

import (
	"testing"
)

func TestKeyDeterministic(t *testing.T) {
	k1 := Key("org1", "overview", "2024-01-01", "2024-01-02")
	k2 := Key("org1", "overview", "2024-01-01", "2024-01-02")
	if k1 != k2 {
		t.Errorf("expected identical keys, got %s and %s", k1, k2)
	}
}

func TestKeyDifferentParams(t *testing.T) {
	k1 := Key("org1", "overview", "2024-01-01", "2024-01-02")
	k2 := Key("org1", "overview", "2024-01-01", "2024-01-03")
	if k1 == k2 {
		t.Errorf("expected different keys for different params, got %s", k1)
	}
}

func TestKeyDifferentOrgs(t *testing.T) {
	k1 := Key("org1", "overview")
	k2 := Key("org2", "overview")
	if k1 == k2 {
		t.Errorf("expected different keys for different orgs, got %s", k1)
	}
}

func TestKeyLength(t *testing.T) {
	k := Key("org1", "query", "param1", "param2")
	if len(k) != 16 {
		t.Errorf("expected key length 16, got %d", len(k))
	}
}

func TestNilRedisGet(t *testing.T) {
	c := NewQueryCache(nil)
	var dest map[string]interface{}
	if c.Get(nil, "key", &dest) {
		t.Error("expected false from nil redis Get")
	}
}

func TestNilRedisSet(t *testing.T) {
	c := NewQueryCache(nil)
	// Should not panic
	c.Set(nil, "key", map[string]string{"a": "b"}, 0)
}

func TestNilRedisInvalidate(t *testing.T) {
	c := NewQueryCache(nil)
	// Should not panic
	c.Invalidate(nil, "key1", "key2")
}
