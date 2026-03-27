package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/traceform/traceform/internal/audit"
	"github.com/traceform/traceform/internal/auth"
	"github.com/traceform/traceform/internal/cache"
	costhandler "github.com/traceform/traceform/internal/cost/handler"
	costservice "github.com/traceform/traceform/internal/cost/service"
	coststore "github.com/traceform/traceform/internal/cost/store"
	datasethandler "github.com/traceform/traceform/internal/dataset/handler"
	datasetservice "github.com/traceform/traceform/internal/dataset/service"
	datasetstore "github.com/traceform/traceform/internal/dataset/store"
	guardhandler "github.com/traceform/traceform/internal/guard/handler"
	guardservice "github.com/traceform/traceform/internal/guard/service"
	guardstore "github.com/traceform/traceform/internal/guard/store"
	otelhandler "github.com/traceform/traceform/internal/otel/handler"
	otelservice "github.com/traceform/traceform/internal/otel/service"
	prompthandler "github.com/traceform/traceform/internal/prompt/handler"
	promptservice "github.com/traceform/traceform/internal/prompt/service"
	promptstore "github.com/traceform/traceform/internal/prompt/store"
	routehandler "github.com/traceform/traceform/internal/route/handler"
	routeservice "github.com/traceform/traceform/internal/route/service"
	routestore "github.com/traceform/traceform/internal/route/store"
	"github.com/traceform/traceform/internal/server/middleware"
	"github.com/traceform/traceform/internal/storage"
	shieldhandler "github.com/traceform/traceform/internal/shield/handler"
	shieldservice "github.com/traceform/traceform/internal/shield/service"
	shieldstore "github.com/traceform/traceform/internal/shield/store"
	testhandler "github.com/traceform/traceform/internal/test/handler"
	testservice "github.com/traceform/traceform/internal/test/service"
	teststore "github.com/traceform/traceform/internal/test/store"
	tracehandler "github.com/traceform/traceform/internal/trace/handler"
	"github.com/traceform/traceform/internal/trace/service"
	"github.com/traceform/traceform/internal/trace/store"
	webhookhandler "github.com/traceform/traceform/internal/webhook/handler"
	webhookservice "github.com/traceform/traceform/internal/webhook/service"
	webhookstore "github.com/traceform/traceform/internal/webhook/store"
	"github.com/go-chi/chi/v5"
)

func (s *Server) setupRoutes() {
	// Health check — unauthenticated
	s.router.Get("/health", s.handleHealth)
	s.router.Get("/ready", s.handleReady)

	// API Documentation — serve OpenAPI spec and Swagger UI
	s.router.Get("/docs/openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		http.ServeFile(w, r, "docs/api/openapi.yaml")
	})
	s.router.Get("/docs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(swaggerUIHTML))
	})

	// --- Build SSO handler ---
	ssoStore := auth.NewSSOStore(s.db)
	encSvcSSO, _ := routeservice.NewEncryption(s.cfg.EncryptionKey)
	ssoHandler := auth.NewSSOHandler(ssoStore, s.jwtManager, encSvcSSO, s.db, s.logger, s.cfg.FrontendURL)

	// Auth routes — unauthenticated
	s.router.Route("/auth", func(r chi.Router) {
		r.Post("/github", s.handleGitHubLogin)
		r.Get("/github/callback", s.handleGitHubCallback)

		// Logout — requires valid JWT to extract jti for revocation
		r.With(middleware.JWTAuth(s.jwtManager, s.tokenRevocation)).Post("/logout", s.handleLogout)

		// SSO routes
		r.Get("/sso/lookup", ssoHandler.HandleSSOLookup)
		r.Post("/saml/acs", ssoHandler.HandleSAMLACSEndpoint)
		r.Get("/oidc/{orgID}/login", ssoHandler.HandleOIDCLogin)
		r.Get("/oidc/callback", ssoHandler.HandleOIDCCallback)
	})

	// --- Build query result cache ---
	// Uses short TTLs (30-60s) so cache expires naturally; no explicit
	// invalidation is needed on the ingest path. For a monitoring tool,
	// 30-60s staleness is acceptable.
	queryCache := cache.NewQueryCache(s.redis)

	// --- Build trace module dependencies ---
	pgStore := store.NewPostgresStore(s.db)
	var chStore *store.ClickHouseStore
	if s.clickhouseDB != nil {
		chStore = store.NewClickHouseStore(s.clickhouseDB)
	}

	// Sampling config
	samplingStore := store.NewSamplingPGStore(s.db)
	samplingSvc := service.NewSamplingService(samplingStore, s.logger)

	ingestSvc := service.NewIngestService(s.nats, s.logger, samplingSvc)

	var sessionSvc *service.SessionService
	var analyticsSvc *service.AnalyticsService
	if chStore != nil {
		sessionSvc = service.NewSessionService(chStore, s.logger)
		analyticsSvc = service.NewAnalyticsService(chStore, s.logger)
	}

	patternSvc := service.NewPatternService(pgStore, s.logger)
	alertSvc := service.NewAlertService(pgStore, s.logger)

	samplingHandler := tracehandler.NewSamplingHandler(samplingSvc, s.logger)

	ingestHandler := tracehandler.NewIngestHandler(ingestSvc, samplingSvc, s.logger)
	ingestHandler.SetMeter(s.meter)
	agentHandler := tracehandler.NewAgentHandler(pgStore, s.logger)
	patternHandler := tracehandler.NewPatternHandler(patternSvc, s.logger)
	alertHandler := tracehandler.NewAlertHandler(alertSvc, s.logger)

	var sessionHandler *tracehandler.SessionHandler
	var analyticsHandler *tracehandler.AnalyticsHandler
	var errorsHandler *tracehandler.ErrorsHandler
	if sessionSvc != nil {
		sessionHandler = tracehandler.NewSessionHandler(sessionSvc, s.logger)
	}
	if analyticsSvc != nil {
		analyticsHandler = tracehandler.NewAnalyticsHandler(analyticsSvc, s.logger)
		analyticsHandler.SetCache(queryCache)
	}
	if chStore != nil {
		errorsHandler = tracehandler.NewErrorsHandler(chStore, s.logger)
	}

	// --- Build blob store for payload retrieval ---
	blobStore := storage.NewFileSystemBlobStore(s.cfg.BlobStorePath)

	var payloadHandler *tracehandler.PayloadHandler
	if s.clickhouseDB != nil {
		payloadHandler = tracehandler.NewPayloadHandler(s.clickhouseDB, blobStore, s.logger)
	}

	// --- Build shield module dependencies ---
	var shieldChStore *shieldstore.ClickHouseStore
	if s.clickhouseDB != nil {
		shieldChStore = shieldstore.NewClickHouseStore(s.clickhouseDB)
	}

	healingSvc := shieldservice.NewHealingService(s.nats, shieldChStore, s.logger)
	healingHandler := shieldhandler.NewHealingHandler(healingSvc, s.logger)

	// API v1 routes — authenticated via JWT (dashboard) or API key (SDKs)
	s.router.Route("/v1", func(r chi.Router) {
		r.Use(middleware.DualAuth(s.jwtManager, s.apiKeyStore, s.tokenRevocation))
		r.Use(middleware.OrgPlanLoader(s.db, s.redis))
		r.Use(middleware.BodyLimit(10 * 1024 * 1024)) // 10MB default

		// Rate limiting
		if s.redis != nil {
			defaultLimit := envInt("RATE_LIMIT_DEFAULT", 1000)
			limiter := middleware.NewRateLimiter(s.redis, defaultLimit, time.Minute)
			r.Use(limiter.Middleware())
		}

		// Trace module: Ingestion routes (higher rate limit for ingest)
		r.Route("/ingest", func(r chi.Router) {
			if s.redis != nil {
				ingestLimit := envInt("RATE_LIMIT_INGEST", 10000)
				r.Use(middleware.RateLimit(s.redis, ingestLimit))
			}
			r.Use(middleware.UsageLimitCheck(s.meter))
			r.Post("/sessions", ingestHandler.IngestSession)
			r.Post("/spans", ingestHandler.IngestSpans)
			r.Post("/events", ingestHandler.IngestEvents)
			r.Post("/batch", ingestHandler.IngestBatch)

			// Shield module: Healing event ingestion
			r.Post("/healing", healingHandler.IngestHealing)
		})

		// Trace module: Session query routes
		r.Route("/sessions", func(r chi.Router) {
			if sessionHandler != nil {
				r.Get("/", sessionHandler.ListSessions)
				r.Get("/{id}", sessionHandler.GetSession)
				r.Get("/{id}/spans", sessionHandler.GetSessionSpans)
				r.Get("/{id}/events", sessionHandler.GetSessionEvents)
			}

			// Shield module: Healing events per session
			r.Get("/{id}/healing", healingHandler.GetSessionHealing)
		})

		// Trace module: Span payload retrieval
		r.Route("/spans", func(r chi.Router) {
			if payloadHandler != nil {
				r.Get("/{spanID}/payload", payloadHandler.GetPayload)
			}
		})

		// Trace module: Analytics routes
		r.Route("/analytics", func(r chi.Router) {
			if analyticsHandler != nil {
				r.Get("/overview", analyticsHandler.Overview)
				r.Get("/sessions-over-time", analyticsHandler.SessionsOverTime)
				r.Get("/failure-rate", analyticsHandler.FailureRate)
			}

			// Shield module: Healing analytics
			r.Get("/healing", healingHandler.HealingAnalytics)
		})

		// Trace module: Error groups (fingerprinted error deduplication)
		r.Route("/errors", func(r chi.Router) {
			if errorsHandler != nil {
				r.Get("/", errorsHandler.ListGroups)
				r.Get("/{fingerprint}", errorsHandler.GetGroup)
			}
		})

		// Trace module: Agent definitions CRUD
		r.Route("/agents", func(r chi.Router) {
			r.Get("/", agentHandler.List)
			r.Get("/{id}", agentHandler.Get)
			r.With(middleware.RequireRole("admin")).Post("/", agentHandler.Create)
			r.With(middleware.RequireRole("admin")).Put("/{id}", agentHandler.Update)
			r.With(middleware.RequireRole("admin")).Delete("/{id}", agentHandler.Delete)
		})

		// Trace module: Failure patterns CRUD
		r.Route("/patterns", func(r chi.Router) {
			r.Get("/", patternHandler.List)
			r.Get("/{id}", patternHandler.Get)
			r.With(middleware.RequireRole("admin")).Post("/", patternHandler.Create)
			r.With(middleware.RequireRole("admin")).Put("/{id}", patternHandler.Update)
			r.With(middleware.RequireRole("admin")).Delete("/{id}", patternHandler.Delete)
		})

		// Trace module: Alert rules CRUD
		r.Route("/alerts", func(r chi.Router) {
			r.Get("/", alertHandler.List)
			r.Get("/{id}", alertHandler.Get)
			r.With(middleware.RequireRole("admin")).Post("/", alertHandler.Create)
			r.With(middleware.RequireRole("admin")).Put("/{id}", alertHandler.Update)
			r.With(middleware.RequireRole("admin")).Delete("/{id}", alertHandler.Delete)
		})

		// Trace module: Sampling config CRUD
		r.Route("/settings/sampling", func(r chi.Router) {
			r.Get("/", samplingHandler.List)
			r.With(middleware.RequireRole("admin")).Put("/", samplingHandler.Upsert)
			r.With(middleware.RequireRole("admin")).Delete("/{id}", samplingHandler.Delete)
		})

		// --- Build test module dependencies ---
		testPgStore := teststore.NewPostgresStore(s.db)
		evalSvc := testservice.NewEvaluatorService(s.logger, nil)
		runnerSvc := testservice.NewRunnerService(testPgStore, evalSvc, s.logger)

		suiteHandler := testhandler.NewSuiteHandler(testPgStore, s.logger)
		caseHandler := testhandler.NewCaseHandler(testPgStore, s.logger)
		runHandler := testhandler.NewRunHandler(testPgStore, runnerSvc, s.nats, s.logger)
		evaluatorHandler := testhandler.NewEvaluatorHandler(testPgStore, s.logger)

		// Test module routes
		r.Route("/test", func(r chi.Router) {
			// Test suites CRUD
			r.Route("/suites", func(r chi.Router) {
				r.Get("/", suiteHandler.List)
				r.Get("/{id}", suiteHandler.Get)
				r.Put("/{id}", suiteHandler.Update)
				r.With(middleware.RequireRole("admin")).Post("/", suiteHandler.Create)
				r.With(middleware.RequireRole("admin")).Delete("/{id}", suiteHandler.Delete)

				// Test cases within a suite
				r.Get("/{suiteId}/cases", caseHandler.List)
				r.With(middleware.RequireRole("admin")).Post("/{suiteId}/cases", caseHandler.Create)

				// Start a test run for a suite
				r.With(middleware.RequireRole("admin")).Post("/{suiteId}/run", runHandler.StartRun)
			})

			// Test cases (direct access by ID)
			r.Route("/cases", func(r chi.Router) {
				r.Get("/{id}", caseHandler.Get)
				r.With(middleware.RequireRole("admin")).Put("/{id}", caseHandler.Update)
				r.With(middleware.RequireRole("admin")).Delete("/{id}", caseHandler.Delete)
			})

			// Test runs
			r.Route("/runs", func(r chi.Router) {
				r.Get("/", runHandler.List)
				r.Get("/{id}", runHandler.Get)
			})

			// Evaluators CRUD
			r.Route("/evaluators", func(r chi.Router) {
				r.Get("/", evaluatorHandler.List)
				r.Get("/{id}", evaluatorHandler.Get)
				r.With(middleware.RequireRole("admin")).Post("/", evaluatorHandler.Create)
				r.With(middleware.RequireRole("admin")).Put("/{id}", evaluatorHandler.Update)
				r.With(middleware.RequireRole("admin")).Delete("/{id}", evaluatorHandler.Delete)
			})

			// CI/CD endpoint
			r.With(middleware.RequireRole("admin")).Post("/ci/run", runHandler.CIRun)
		})

		// --- Build guard module dependencies ---
		guardPgStore := guardstore.NewPostgresStore(s.db)
		guardEngine := guardservice.NewEngine(guardPgStore, s.logger)

		rulesHandler := guardhandler.NewRulesHandler(guardPgStore, s.logger)
		checkHandler := guardhandler.NewCheckHandler(guardEngine, guardPgStore, s.logger)
		eventsHandler := guardhandler.NewEventsHandler(guardPgStore, s.logger)

		// Guard module routes
		r.Route("/guard", func(r chi.Router) {
			// Guardrail rules CRUD
			r.Route("/rules", func(r chi.Router) {
				r.Get("/", rulesHandler.List)
				r.Get("/{id}", rulesHandler.Get)
				r.With(middleware.RequireRole("admin")).Post("/", rulesHandler.Create)
				r.With(middleware.RequireRole("admin")).Put("/{id}", rulesHandler.Update)
				r.With(middleware.RequireRole("admin")).Delete("/{id}", rulesHandler.Delete)
			})

			// Guard check endpoint
			r.With(middleware.RequireRole("admin")).Post("/check", checkHandler.Check)

			// Guard events
			r.Get("/events", eventsHandler.ListEvents)

			// Guard analytics
			r.Get("/analytics", eventsHandler.Analytics)
		})

		// --- Build cost module dependencies ---
		costPgStore := coststore.NewPostgresStore(s.db)
		trackerSvc := costservice.NewTrackerService(costPgStore, s.logger)
		costAnalyticsSvc := costservice.NewAnalyticsService(costPgStore, s.logger)

		costEventsHandler := costhandler.NewEventsHandler(trackerSvc, s.logger)
		costAnalyticsHandler := costhandler.NewAnalyticsHandler(costAnalyticsSvc, s.logger)
		costAnalyticsHandler.SetCache(queryCache)
		costBudgetsHandler := costhandler.NewBudgetsHandler(costPgStore, s.logger)
		costModelsHandler := costhandler.NewModelsHandler(costPgStore, s.logger)

		// Cost module routes
		r.Route("/cost", func(r chi.Router) {
			// Cost events
			r.Get("/events", costEventsHandler.List)
			r.With(middleware.RequireRole("admin")).Post("/events", costEventsHandler.Record)

			// Cost analytics
			r.Route("/analytics", func(r chi.Router) {
				r.Get("/summary", costAnalyticsHandler.Summary)
				r.Get("/by-model", costAnalyticsHandler.ByModel)
				r.Get("/by-agent", costAnalyticsHandler.ByAgent)
				r.Get("/top-spenders", costAnalyticsHandler.TopSpenders)
				r.Get("/compare", costAnalyticsHandler.Compare)
			})

			// Budget policies CRUD
			r.Route("/budgets", func(r chi.Router) {
				r.Get("/", costBudgetsHandler.List)
				r.Get("/{id}", costBudgetsHandler.Get)
				r.With(middleware.RequireRole("admin")).Post("/", costBudgetsHandler.Create)
				r.With(middleware.RequireRole("admin")).Put("/{id}", costBudgetsHandler.Update)
				r.With(middleware.RequireRole("admin")).Delete("/{id}", costBudgetsHandler.Delete)
			})

			// Model pricing
			r.Get("/models", costModelsHandler.List)
			r.With(middleware.RequireRole("admin")).Put("/models", costModelsHandler.Upsert)
		})

		// --- Build prompt module dependencies ---
		promptPgStore := promptstore.NewPostgresStore(s.db)
		promptSvc := promptservice.NewPromptService(promptPgStore, s.logger)
		versionSvc := promptservice.NewVersionService(promptPgStore, s.logger)

		promptsHandler := prompthandler.NewPromptsHandler(promptSvc, s.logger)
		versionsHandler := prompthandler.NewVersionsHandler(versionSvc, s.logger)

		// --- Build route module dependencies ---
		routePgStore := routestore.New(s.db)
		encSvc, _ := routeservice.NewEncryption(s.cfg.EncryptionKey)

		// Build playground executor (depends on route module)
		playgroundExecutor := promptservice.NewExecutor(routePgStore, encSvc, s.logger)
		playgroundHandler := prompthandler.NewPlaygroundHandler(playgroundExecutor, promptSvc, s.logger)

		providerHandler := routehandler.NewProviderHandler(routePgStore, encSvc, s.logger)
		routeRulesHandler := routehandler.NewRouteHandler(routePgStore, s.logger)
		fallbackHandler := routehandler.NewFallbackHandler(routePgStore, s.logger)
		cacheHandler := routehandler.NewCacheHandler(routePgStore, s.logger)
		gatewayAnalyticsHandler := routehandler.NewAnalyticsHandler(routePgStore, s.logger)

		// Route module management
		r.Route("/gateway", func(r chi.Router) {
			// Providers CRUD
			r.Route("/providers", func(r chi.Router) {
				r.Get("/", providerHandler.List)
				r.Get("/{id}", providerHandler.Get)
				r.With(middleware.RequireRole("admin")).Post("/", providerHandler.Create)
				r.With(middleware.RequireRole("admin")).Put("/{id}", providerHandler.Update)
				r.With(middleware.RequireRole("admin")).Delete("/{id}", providerHandler.Delete)
			})

			// Routing rules CRUD
			r.Route("/routes", func(r chi.Router) {
				r.Get("/", routeRulesHandler.List)
				r.With(middleware.RequireRole("admin")).Post("/", routeRulesHandler.Create)
				r.With(middleware.RequireRole("admin")).Put("/{id}", routeRulesHandler.Update)
				r.With(middleware.RequireRole("admin")).Delete("/{id}", routeRulesHandler.Delete)
			})

			// Fallback chains CRUD
			r.Route("/fallbacks", func(r chi.Router) {
				r.Get("/", fallbackHandler.List)
				r.Get("/{id}", fallbackHandler.Get)
				r.With(middleware.RequireRole("admin")).Post("/", fallbackHandler.Create)
				r.With(middleware.RequireRole("admin")).Put("/{id}", fallbackHandler.Update)
				r.With(middleware.RequireRole("admin")).Delete("/{id}", fallbackHandler.Delete)
			})

			// Cache management
			r.Get("/cache/stats", cacheHandler.Stats)
			r.With(middleware.RequireRole("admin")).Post("/cache/purge", cacheHandler.Purge)

			// Gateway analytics
			r.Get("/analytics", gatewayAnalyticsHandler.GetAnalytics)
		})

		// --- Prompt Management routes ---
		r.Route("/prompts", func(r chi.Router) {
			r.Get("/", promptsHandler.List)
			r.Get("/slug/{slug}", promptsHandler.GetBySlug)
			r.Get("/{id}", promptsHandler.Get)
			r.With(middleware.RequireRole("admin")).Post("/", promptsHandler.Create)
			r.With(middleware.RequireRole("admin")).Patch("/{id}", promptsHandler.Update)
			r.With(middleware.RequireRole("admin")).Delete("/{id}", promptsHandler.Delete)

			// Version management
			r.Get("/{id}/versions", versionsHandler.List)
			r.Get("/{id}/versions/{version}", versionsHandler.Get)
			r.With(middleware.RequireRole("admin")).Post("/{id}/versions", versionsHandler.Create)
			r.With(middleware.RequireRole("admin")).Post("/{id}/deploy/{version}", versionsHandler.Deploy)
			r.With(middleware.RequireRole("admin")).Post("/{id}/rollback", versionsHandler.Rollback)
		})

		// --- Playground routes ---
		r.Route("/playground", func(r chi.Router) {
			r.Post("/execute", playgroundHandler.Execute)
			r.Post("/compare", playgroundHandler.Compare)
		})

		// --- Build dataset module dependencies ---
		datasetPgStore := datasetstore.NewPostgresStore(s.db)
		datasetSvc := datasetservice.NewDatasetService(datasetPgStore, s.logger)
		importerSvc := datasetservice.NewImporter(datasetPgStore, s.logger)
		exporterSvc := datasetservice.NewExporter(datasetPgStore, s.logger)

		dsHandler := datasethandler.NewDatasetHandler(datasetSvc, s.logger)
		dsItemHandler := datasethandler.NewItemHandler(datasetSvc, importerSvc, exporterSvc, s.logger)

		// Dataset module routes
		r.Route("/datasets", func(r chi.Router) {
			r.Get("/", dsHandler.List)
			r.Get("/{id}", dsHandler.Get)
			r.Get("/{id}/items", dsItemHandler.List)
			r.Get("/{id}/items/{itemID}", dsItemHandler.Get)
			r.Get("/{id}/export", dsItemHandler.Export)
			r.With(middleware.RequireRole("admin")).Post("/", dsHandler.Create)
			r.With(middleware.RequireRole("admin")).Patch("/{id}", dsHandler.Update)
			r.With(middleware.RequireRole("admin")).Delete("/{id}", dsHandler.Delete)
			r.With(middleware.RequireRole("admin")).Post("/{id}/link/{suiteID}", dsHandler.LinkSuite)
			r.With(middleware.RequireRole("admin")).Delete("/{id}/link/{suiteID}", dsHandler.UnlinkSuite)
			r.With(middleware.RequireRole("admin")).Post("/{id}/items", dsItemHandler.Create)
			r.With(middleware.RequireRole("admin")).Post("/{id}/items/batch", dsItemHandler.CreateBatch)
			r.With(middleware.RequireRole("admin")).Delete("/{id}/items/{itemID}", dsItemHandler.Delete)
			r.With(middleware.RequireRole("admin")).Post("/{id}/import", dsItemHandler.Import)
			r.With(middleware.RequireRole("admin")).Post("/from-session/{sessionID}", dsHandler.FromSession)
		})

		// --- Build OTel module dependencies ---
		otelTranslator := otelservice.NewTranslator(s.logger)
		otlpHandler := otelhandler.NewOTLPHandler(otelTranslator, ingestSvc, s.logger)

		// OTel OTLP receiver route
		r.Route("/otlp", func(r chi.Router) {
			r.Post("/v1/traces", otlpHandler.ReceiveTraces)
		})

		// --- Build webhook module dependencies ---
		webhookPgStore := webhookstore.NewPostgresStore(s.db)
		webhookDispatcher := webhookservice.NewDispatcher(webhookPgStore, s.nats, s.logger)

		whHandler := webhookhandler.NewWebhookHandler(webhookPgStore, webhookDispatcher, s.logger)
		whDeliveryHandler := webhookhandler.NewDeliveryHandler(webhookPgStore, webhookDispatcher, s.logger)

		// Webhook module routes
		r.Route("/webhooks", func(r chi.Router) {
			r.Get("/", whHandler.List)
			r.Get("/{id}", whHandler.Get)
			r.Get("/{id}/deliveries", whDeliveryHandler.List)
			r.With(middleware.RequireRole("admin")).Post("/", whHandler.Create)
			r.With(middleware.RequireRole("admin")).Patch("/{id}", whHandler.Update)
			r.With(middleware.RequireRole("admin")).Delete("/{id}", whHandler.Delete)
			r.With(middleware.RequireRole("admin")).Post("/{id}/test", whHandler.Test)
			r.With(middleware.RequireRole("admin")).Post("/{id}/deliveries/{deliveryID}/retry", whDeliveryHandler.Retry)
		})

		// --- Data export routes (admin only, requires data_export feature) ---
		r.Route("/export", func(r chi.Router) {
			r.Use(middleware.RequireRole("admin"))
			r.Use(middleware.RequireFeature("data_export"))
			r.Get("/", s.handleExportFormats)
			r.Get("/sessions", s.handleExportSessions)
			r.Get("/cost", s.handleExportCostEvents)
			r.Get("/audit", s.handleExportAuditLogs)
		})
	})

	// Dashboard API — authenticated via JWT
	s.router.Route("/api", func(r chi.Router) {
		r.Use(middleware.JWTAuth(s.jwtManager, s.tokenRevocation))
		r.Use(middleware.OrgPlanLoader(s.db, s.redis))

		// Organization management — owner only
		r.Route("/org", func(r chi.Router) {
			r.Use(middleware.RequireRole("owner"))
			r.Get("/", s.handleGetOrg)
			r.Patch("/", s.handleUpdateOrg)
			r.Delete("/", s.handleDeleteOrg)
			r.Get("/usage", s.handleGetOrgUsage)

			// GDPR data deletion endpoints
			r.Delete("/data", s.handleDeleteOrgData)
			r.Delete("/data/sessions", s.handleDeleteOrgSessions)
		})

		// API key management
		r.Route("/api-keys", func(r chi.Router) {
			r.Get("/", s.handleListAPIKeys)
			r.With(middleware.RequireRole("admin")).Post("/", s.handleCreateAPIKey)
			r.With(middleware.RequireRole("admin")).Post("/{id}/rotate", s.handleRotateAPIKey)
			r.With(middleware.RequireRole("admin")).Delete("/{id}", s.handleDeleteAPIKey)
		})

		// Team management
		r.Route("/team", func(r chi.Router) {
			r.Get("/", s.handleListTeam)
			r.With(middleware.RequireRole("owner")).Post("/invite", s.handleInviteTeamMember)
			r.With(middleware.RequireRole("owner")).Patch("/{id}/role", s.handleUpdateTeamMemberRole)
			r.With(middleware.RequireRole("owner")).Delete("/{id}", s.handleRemoveTeamMember)
		})

		// Usage & billing info
		r.Get("/usage", s.handleGetUsage)

		// License info
		r.Get("/license", s.handleGetLicense)

		// Audit logs — admin only, requires audit_log feature
		auditHandler := audit.NewHandler(audit.NewStore(s.db), s.logger)
		r.Route("/audit-logs", func(r chi.Router) {
			r.Use(middleware.RequireRole("admin"))
			r.Use(middleware.RequireFeature("audit_log"))
			r.Get("/", auditHandler.List)
		})

		// SSO configuration — owner only, requires sso feature
		r.Route("/sso", func(r chi.Router) {
			r.Use(middleware.RequireRole("owner"))
			r.Use(middleware.RequireFeature("sso"))
			r.Get("/", ssoHandler.HandleSSOConfigGet)
			r.Post("/", ssoHandler.HandleSSOConfigUpsert)
			r.Delete("/", ssoHandler.HandleSSOConfigDelete)
		})
	})
}

// checkDependencies pings every backing service and returns a map of
// dependency name to "healthy" / "unhealthy".
func (s *Server) checkDependencies(ctx context.Context) map[string]string {
	deps := map[string]string{}

	// PostgreSQL
	if err := s.db.PingContext(ctx); err != nil {
		deps["postgresql"] = "unhealthy"
	} else {
		deps["postgresql"] = "healthy"
	}

	// ClickHouse
	if s.clickhouseDB != nil {
		if err := s.clickhouseDB.PingContext(ctx); err != nil {
			deps["clickhouse"] = "unhealthy"
		} else {
			deps["clickhouse"] = "healthy"
		}
	} else {
		deps["clickhouse"] = "unhealthy"
	}

	// Redis
	if s.redis != nil {
		if err := s.redis.Ping(ctx).Err(); err != nil {
			deps["redis"] = "unhealthy"
		} else {
			deps["redis"] = "healthy"
		}
	} else {
		deps["redis"] = "unhealthy"
	}

	// NATS
	if s.nats != nil && s.nats.IsConnected() {
		deps["nats"] = "healthy"
	} else {
		deps["nats"] = "unhealthy"
	}

	return deps
}

// handleHealth returns the overall service health with dependency status.
// GET /health
//
//	{
//	    "status": "healthy" | "degraded",
//	    "version": "1.0.0",
//	    "time": "2026-03-26T...",
//	    "dependencies": { "postgresql": "healthy", ... }
//	}
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	deps := s.checkDependencies(r.Context())

	overall := "healthy"
	for _, v := range deps {
		if v != "healthy" {
			overall = "degraded"
			break
		}
	}

	WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":       overall,
		"version":      "1.0.0",
		"time":         time.Now().UTC().Format(time.RFC3339),
		"dependencies": deps,
	})
}

// handleReady returns 200 only when ALL dependencies are healthy.
// Designed for use as a Kubernetes readiness probe.
// GET /ready
func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	deps := s.checkDependencies(r.Context())

	for _, v := range deps {
		if v != "healthy" {
			WriteJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
				"status":       "not ready",
				"dependencies": deps,
			})
			return
		}
	}

	WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":       "ready",
		"dependencies": deps,
	})
}

func (s *Server) handleGitHubLogin(w http.ResponseWriter, r *http.Request) {
	if s.cfg.GitHubClientID == "" {
		WriteError(w, http.StatusNotImplemented, "OAUTH_NOT_CONFIGURED", "GitHub OAuth is not configured")
		return
	}

	oauth := &auth.GitHubOAuth{
		ClientID:     s.cfg.GitHubClientID,
		ClientSecret: s.cfg.GitHubClientSecret,
		RedirectURL:  s.cfg.FrontendURL + "/callback",
	}

	state := "random-state" // TODO: generate and store CSRF token
	WriteJSON(w, http.StatusOK, map[string]string{
		"url": oauth.AuthorizeURL(state),
	})
}

func (s *Server) handleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_CODE", "authorization code is required")
		return
	}

	oauth := &auth.GitHubOAuth{
		ClientID:     s.cfg.GitHubClientID,
		ClientSecret: s.cfg.GitHubClientSecret,
		RedirectURL:  s.cfg.FrontendURL + "/callback",
	}

	accessToken, err := oauth.ExchangeCode(r.Context(), code)
	if err != nil {
		slog.Error("github oauth: failed to exchange code", "error", err)
		WriteError(w, http.StatusBadRequest, "OAUTH_ERROR", "failed to exchange authorization code")
		return
	}

	ghUser, err := oauth.GetUser(r.Context(), accessToken)
	if err != nil {
		slog.Error("github oauth: failed to fetch user", "error", err)
		WriteError(w, http.StatusInternalServerError, "GITHUB_ERROR", "failed to fetch user profile")
		return
	}
	slog.Info("github oauth: got user", "login", ghUser.Login, "email", ghUser.Email, "id", ghUser.ID)

	// Upsert user and org
	var userID, orgID string

	// Check if user already exists
	err = s.db.QueryRowContext(r.Context(),
		`SELECT id, org_id FROM users WHERE github_id = $1`, ghUser.ID,
	).Scan(&userID, &orgID)

	if err != nil {
		// New user — create an org for them, then insert user
		tx, txErr := s.db.BeginTx(r.Context(), nil)
		if txErr != nil {
			slog.Error("github oauth: tx begin failed", "error", txErr)
			WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to start transaction")
			return
		}
		defer tx.Rollback()

		orgName := ghUser.Login + "'s Org"
		if orgName == "'s Org" {
			orgName = "Personal"
		}
		err = tx.QueryRowContext(r.Context(),
			`INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
			orgName, ghUser.Login,
		).Scan(&orgID)
		if err != nil {
			// Slug conflict — try with suffix
			err = tx.QueryRowContext(r.Context(),
				`INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
				orgName, fmt.Sprintf("%s-%d", ghUser.Login, ghUser.ID),
			).Scan(&orgID)
			if err != nil {
				slog.Error("github oauth: failed to create org", "error", err)
				WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to create organization")
				return
			}
		}

		err = tx.QueryRowContext(r.Context(),
			`INSERT INTO users (email, name, avatar_url, github_id, org_id, role)
			 VALUES ($1, $2, $3, $4, $5, 'owner')
			 RETURNING id`,
			ghUser.Email, ghUser.Name, ghUser.AvatarURL, ghUser.ID, orgID,
		).Scan(&userID)
		if err != nil {
			slog.Error("github oauth: failed to create user", "error", err)
			WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to create user")
			return
		}

		// Create a default API key for the new org
		apiKey, _ := auth.GenerateAPIKey()
		keyHash := auth.HashAPIKey(apiKey)
		keyPrefix := auth.KeyPrefix(apiKey)
		_, _ = tx.ExecContext(r.Context(),
			`INSERT INTO api_keys (org_id, name, key_hash, key_prefix, created_by)
			 VALUES ($1, 'Default Key', $2, $3, $4)`,
			orgID, keyHash, keyPrefix, userID,
		)

		// Seed default guardrails for new org
		defaultGuards := []struct {
			name, gtype, mode, applyTo, config string
		}{
			{"PII Detection", "pii", "block", "both", `{"detect":["email","phone","ssn","credit_card","ip_address"]}`},
			{"Prompt Injection Guard", "injection", "block", "input", `{}`},
			{"Toxicity Filter", "toxicity", "warn", "both", `{"categories":["profanity","threats","hate_speech","harassment"]}`},
			{"Code Execution Guard", "code_exec", "block", "input", `{}`},
			{"Length Guard", "length", "warn", "both", `{"max_chars":10000,"max_tokens":4000}`},
			{"Hallucination Detection", "hallucination", "warn", "output", `{}`},
		}
		for _, g := range defaultGuards {
			_, _ = tx.ExecContext(r.Context(),
				`INSERT INTO guardrails (org_id, name, type, mode, apply_to, config, is_builtin, enabled)
				 VALUES ($1, $2, $3, $4, $5, $6, true, true)`,
				orgID, g.name, g.gtype, g.mode, g.applyTo, g.config,
			)
		}

		if txErr = tx.Commit(); txErr != nil {
			WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to commit transaction")
			return
		}
	} else {
		// Existing user — update profile
		_, _ = s.db.ExecContext(r.Context(),
			`UPDATE users SET name = $1, avatar_url = $2, updated_at = NOW() WHERE id = $3`,
			ghUser.Name, ghUser.AvatarURL, userID,
		)
	}

	// Generate JWT
	token, err := s.jwtManager.GenerateToken(userID, orgID, ghUser.Email, "owner")
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "TOKEN_ERROR", "failed to generate token")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":         userID,
			"email":      ghUser.Email,
			"name":       ghUser.Name,
			"avatar_url": ghUser.AvatarURL,
		},
	})
}

// envInt reads an integer from an environment variable or returns the fallback.
func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

// Ensure packages are used
var _ = auth.HashAPIKey

// swaggerUIHTML is the HTML page that loads Swagger UI from a CDN.
const swaggerUIHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Traceform API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #1a1a2e; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/docs/openapi.yaml",
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset
      ],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>`
