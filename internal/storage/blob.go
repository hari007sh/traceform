package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// BlobStore stores and retrieves large payloads by content hash (SHA-256).
type BlobStore interface {
	Put(ctx context.Context, hash string, data []byte) error
	Get(ctx context.Context, hash string) ([]byte, error)
	Delete(ctx context.Context, hash string) error
	Exists(ctx context.Context, hash string) (bool, error)
}

// FileSystemBlobStore stores blobs on local filesystem with sharded directories:
// {basePath}/{hash[:2]}/{hash[2:4]}/{hash}
type FileSystemBlobStore struct {
	basePath string
}

func NewFileSystemBlobStore(basePath string) *FileSystemBlobStore {
	return &FileSystemBlobStore{basePath: basePath}
}

func (s *FileSystemBlobStore) path(hash string) string {
	if len(hash) < 4 {
		return filepath.Join(s.basePath, hash)
	}
	return filepath.Join(s.basePath, hash[:2], hash[2:4], hash)
}

func (s *FileSystemBlobStore) Put(ctx context.Context, hash string, data []byte) error {
	p := s.path(hash)
	if _, err := os.Stat(p); err == nil {
		return nil // dedup: already exists
	}
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	return os.WriteFile(p, data, 0644)
}

func (s *FileSystemBlobStore) Get(ctx context.Context, hash string) ([]byte, error) {
	data, err := os.ReadFile(s.path(hash))
	if err != nil {
		return nil, fmt.Errorf("blob not found: %s", hash)
	}
	return data, nil
}

func (s *FileSystemBlobStore) Delete(ctx context.Context, hash string) error {
	err := os.Remove(s.path(hash))
	if os.IsNotExist(err) {
		return nil // already gone
	}
	return err
}

func (s *FileSystemBlobStore) Exists(ctx context.Context, hash string) (bool, error) {
	_, err := os.Stat(s.path(hash))
	if os.IsNotExist(err) {
		return false, nil
	}
	return err == nil, err
}
