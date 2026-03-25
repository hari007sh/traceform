package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestFileSystemBlobStore_PutGetDelete(t *testing.T) {
	dir := t.TempDir()
	store := NewFileSystemBlobStore(dir)
	ctx := context.Background()

	hash := "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
	data := []byte("hello, blob world")

	// Put
	if err := store.Put(ctx, hash, data); err != nil {
		t.Fatalf("Put failed: %v", err)
	}

	// Exists should return true
	exists, err := store.Exists(ctx, hash)
	if err != nil {
		t.Fatalf("Exists failed: %v", err)
	}
	if !exists {
		t.Fatal("Exists returned false after Put")
	}

	// Get should return matching data
	got, err := store.Get(ctx, hash)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if string(got) != string(data) {
		t.Fatalf("Get returned %q, want %q", got, data)
	}

	// Verify sharded path on disk: {basePath}/{hash[:2]}/{hash[2:4]}/{hash}
	expectedPath := filepath.Join(dir, hash[:2], hash[2:4], hash)
	if _, err := os.Stat(expectedPath); err != nil {
		t.Fatalf("sharded path %s does not exist on disk: %v", expectedPath, err)
	}

	// Delete
	if err := store.Delete(ctx, hash); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Exists should return false after Delete
	exists, err = store.Exists(ctx, hash)
	if err != nil {
		t.Fatalf("Exists after Delete failed: %v", err)
	}
	if exists {
		t.Fatal("Exists returned true after Delete")
	}
}

func TestFileSystemBlobStore_PutDedup(t *testing.T) {
	dir := t.TempDir()
	store := NewFileSystemBlobStore(dir)
	ctx := context.Background()

	hash := "deadbeef12345678deadbeef12345678deadbeef12345678deadbeef12345678"
	data := []byte("original data")

	// First Put
	if err := store.Put(ctx, hash, data); err != nil {
		t.Fatalf("first Put failed: %v", err)
	}

	// Second Put with same hash — should not error
	if err := store.Put(ctx, hash, []byte("different data")); err != nil {
		t.Fatalf("second Put failed: %v", err)
	}

	// Data should still be the original (dedup skips overwrite)
	got, err := store.Get(ctx, hash)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if string(got) != string(data) {
		t.Fatalf("Get returned %q after dedup Put, want original %q", got, data)
	}
}

func TestFileSystemBlobStore_GetNotFound(t *testing.T) {
	dir := t.TempDir()
	store := NewFileSystemBlobStore(dir)
	ctx := context.Background()

	_, err := store.Get(ctx, "nonexistenthash1234567890abcdef1234567890abcdef1234567890abcdef12")
	if err == nil {
		t.Fatal("Get on nonexistent hash should return error, got nil")
	}
}

func TestFileSystemBlobStore_DeleteNotFound(t *testing.T) {
	dir := t.TempDir()
	store := NewFileSystemBlobStore(dir)
	ctx := context.Background()

	// Delete nonexistent hash — should return nil (idempotent)
	err := store.Delete(ctx, "nonexistenthash1234567890abcdef1234567890abcdef1234567890abcdef12")
	if err != nil {
		t.Fatalf("Delete on nonexistent hash should return nil, got: %v", err)
	}
}

func TestFileSystemBlobStore_ShortHash(t *testing.T) {
	dir := t.TempDir()
	store := NewFileSystemBlobStore(dir)
	ctx := context.Background()

	// Hash with fewer than 4 characters — edge case, no sharding
	hash := "ab"
	data := []byte("short hash data")

	if err := store.Put(ctx, hash, data); err != nil {
		t.Fatalf("Put with short hash failed: %v", err)
	}

	// File should be at {basePath}/{hash} directly (no sharding)
	expectedPath := filepath.Join(dir, hash)
	if _, err := os.Stat(expectedPath); err != nil {
		t.Fatalf("short hash path %s does not exist on disk: %v", expectedPath, err)
	}

	exists, err := store.Exists(ctx, hash)
	if err != nil {
		t.Fatalf("Exists failed: %v", err)
	}
	if !exists {
		t.Fatal("Exists returned false for short hash")
	}

	got, err := store.Get(ctx, hash)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if string(got) != string(data) {
		t.Fatalf("Get returned %q, want %q", got, data)
	}

	if err := store.Delete(ctx, hash); err != nil {
		t.Fatalf("Delete with short hash failed: %v", err)
	}

	exists, err = store.Exists(ctx, hash)
	if err != nil {
		t.Fatalf("Exists after Delete failed: %v", err)
	}
	if exists {
		t.Fatal("Exists returned true after Delete for short hash")
	}
}
