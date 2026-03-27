package server

import (
	"net/http"
	"os"
	"time"

	"github.com/traceform/traceform/internal/server/middleware"
)

// licenseInfoResponse is the JSON response for the license info endpoint.
type licenseInfoResponse struct {
	Tier          string   `json:"tier"`
	Org           string   `json:"org"`
	MaxMembers    int      `json:"max_members"`
	RetentionDays int      `json:"retention_days"`
	Features      []string `json:"features"`
	ExpiresAt     *string  `json:"expires_at"`
	Mode          string   `json:"mode"`
	Valid         bool     `json:"valid"`
}

// handleGetLicense returns the current license information.
func (s *Server) handleGetLicense(w http.ResponseWriter, r *http.Request) {
	mode := os.Getenv("TRACEFORM_MODE")
	if mode == "" {
		mode = "self-hosted"
	}

	lic := middleware.GetLicenseFromContext(r.Context())
	if lic == nil {
		// Fallback to the server's loaded license
		lic = s.license
	}
	if lic == nil {
		// No license at all — return community defaults
		WriteJSON(w, http.StatusOK, licenseInfoResponse{
			Tier:          "community",
			Org:           "",
			MaxMembers:    3,
			RetentionDays: 7,
			Features:      []string{},
			ExpiresAt:     nil,
			Mode:          mode,
			Valid:         true,
		})
		return
	}

	resp := licenseInfoResponse{
		Tier:          lic.Tier,
		Org:           lic.Org,
		MaxMembers:    lic.MaxMembers,
		RetentionDays: lic.RetentionDays,
		Features:      lic.Features,
		Mode:          mode,
		Valid:         lic.Valid,
	}

	if !lic.ExpiresAt.IsZero() {
		s := lic.ExpiresAt.Format(time.RFC3339)
		resp.ExpiresAt = &s
	}

	// Ensure features is never null in JSON
	if resp.Features == nil {
		resp.Features = []string{}
	}

	WriteJSON(w, http.StatusOK, resp)
}
