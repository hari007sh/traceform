package service

import (
	"testing"
)

func TestFingerprint_EmptyString(t *testing.T) {
	if got := Fingerprint(""); got != "" {
		t.Errorf("Fingerprint(\"\") = %q, want \"\"", got)
	}
}

func TestFingerprint_IdenticalErrors(t *testing.T) {
	err1 := "Connection refused to provider api.openai.com"
	err2 := "Connection refused to provider api.openai.com"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 != fp2 {
		t.Errorf("identical errors produced different fingerprints: %q != %q", fp1, fp2)
	}
	if fp1 == "" {
		t.Error("fingerprint should not be empty for non-empty error")
	}
}

func TestFingerprint_DifferentUUIDs(t *testing.T) {
	err1 := "session 550e8400-e29b-41d4-a716-446655440000 failed: timeout"
	err2 := "session a1b2c3d4-e5f6-7890-abcd-ef1234567890 failed: timeout"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 != fp2 {
		t.Errorf("errors differing only in UUIDs should have same fingerprint: %q != %q", fp1, fp2)
	}
}

func TestFingerprint_DifferentNumbers(t *testing.T) {
	err1 := "request failed after 3 retries with status 503"
	err2 := "request failed after 5 retries with status 503"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 != fp2 {
		t.Errorf("errors differing only in numbers should have same fingerprint: %q != %q", fp1, fp2)
	}
}

func TestFingerprint_DifferentTimestamps(t *testing.T) {
	err1 := "error at 2026-03-20T10:30:00: connection lost"
	err2 := "error at 2026-03-26T14:45:00: connection lost"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 != fp2 {
		t.Errorf("errors differing only in timestamps should have same fingerprint: %q != %q", fp1, fp2)
	}
}

func TestFingerprint_DifferentIPs(t *testing.T) {
	err1 := "connection refused to 192.168.1.100 port 5432"
	err2 := "connection refused to 10.0.0.55 port 5432"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 != fp2 {
		t.Errorf("errors differing only in IPs should have same fingerprint: %q != %q", fp1, fp2)
	}
}

func TestFingerprint_DifferentPaths(t *testing.T) {
	err1 := "panic at /app/service/handler.go:42"
	err2 := "panic at /app/service/handler.go:99"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 != fp2 {
		t.Errorf("errors differing only in file paths should have same fingerprint: %q != %q", fp1, fp2)
	}
}

func TestFingerprint_DifferentQuotedStrings(t *testing.T) {
	err1 := `failed to parse input "hello world"`
	err2 := `failed to parse input "goodbye moon"`
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 != fp2 {
		t.Errorf("errors differing only in quoted strings should have same fingerprint: %q != %q", fp1, fp2)
	}
}

func TestFingerprint_DifferentHexAddresses(t *testing.T) {
	err1 := "nil pointer dereference at 0x7ffeab12cd34"
	err2 := "nil pointer dereference at 0x00001234abcd"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 != fp2 {
		t.Errorf("errors differing only in hex addresses should have same fingerprint: %q != %q", fp1, fp2)
	}
}

func TestFingerprint_CaseInsensitive(t *testing.T) {
	err1 := "Connection REFUSED"
	err2 := "connection refused"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 != fp2 {
		t.Errorf("case-differing errors should have same fingerprint: %q != %q", fp1, fp2)
	}
}

func TestFingerprint_GenuinelyDifferentErrors(t *testing.T) {
	err1 := "connection refused to provider"
	err2 := "rate limit exceeded for model"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 == fp2 {
		t.Errorf("genuinely different errors should have different fingerprints: both = %q", fp1)
	}
}

func TestFingerprint_AnotherGenuinelyDifferent(t *testing.T) {
	err1 := "timeout waiting for response"
	err2 := "invalid JSON in request body"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 == fp2 {
		t.Errorf("genuinely different errors should have different fingerprints: both = %q", fp1)
	}
}

func TestFingerprint_Length(t *testing.T) {
	fp := Fingerprint("some error")
	if len(fp) != 16 {
		t.Errorf("fingerprint should be 16 hex chars, got %d: %q", len(fp), fp)
	}
}

func TestFingerprint_WhitespaceNormalized(t *testing.T) {
	err1 := "connection   refused   to   host"
	err2 := "connection refused to host"
	fp1 := Fingerprint(err1)
	fp2 := Fingerprint(err2)
	if fp1 != fp2 {
		t.Errorf("errors differing only in whitespace should have same fingerprint: %q != %q", fp1, fp2)
	}
}
