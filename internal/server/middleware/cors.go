package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/cors"
)

// CORS returns a configured CORS middleware.
func CORS(frontendURL string) func(http.Handler) http.Handler {
	origins := []string{frontendURL}

	// Add configured origins
	if extra := os.Getenv("CORS_ORIGINS"); extra != "" {
		for _, o := range strings.Split(extra, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				origins = append(origins, o)
			}
		}
	}

	// Always allow localhost in development
	if os.Getenv("ENVIRONMENT") != "production" {
		origins = append(origins, "http://localhost:3000", "http://localhost:3001")
	}

	return cors.Handler(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	})
}
