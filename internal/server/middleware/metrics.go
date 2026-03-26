package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	httpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "agentstack_http_requests_total",
		Help: "Total number of HTTP requests",
	}, []string{"method", "path", "status"})

	httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "agentstack_http_request_duration_seconds",
		Help:    "HTTP request duration in seconds",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path"})

	activeConnections = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "agentstack_active_connections",
		Help: "Number of active HTTP connections",
	})

	// Business metrics — increment from handlers as needed.

	IngestEventsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "agentstack_ingest_events_total",
		Help: "Total ingested events by type",
	}, []string{"type"}) // session, span, event, healing

	GatewayRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "agentstack_gateway_requests_total",
		Help: "Total gateway proxy requests",
	}, []string{"provider", "model", "status"})

	ActiveSessionsGauge = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "agentstack_active_sessions",
		Help: "Number of currently running sessions",
	})
)

// PrometheusMetrics records HTTP request metrics for Prometheus.
func PrometheusMetrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		activeConnections.Inc()
		defer activeConnections.Dec()

		start := time.Now()
		ww := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(ww, r)

		duration := time.Since(start).Seconds()

		// Normalize path to avoid high cardinality (replace UUIDs)
		path := normalizePath(r.URL.Path)

		httpRequestsTotal.WithLabelValues(r.Method, path, strconv.Itoa(ww.status)).Inc()
		httpRequestDuration.WithLabelValues(r.Method, path).Observe(duration)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func normalizePath(path string) string {
	// Replace UUID segments with :id to prevent cardinality explosion.
	// Any segment that is 36 chars (UUID length) or longer than 20 chars gets replaced.
	parts := strings.Split(path, "/")
	for i, p := range parts {
		if len(p) == 36 || len(p) > 20 {
			parts[i] = ":id"
		}
	}
	return strings.Join(parts, "/")
}
