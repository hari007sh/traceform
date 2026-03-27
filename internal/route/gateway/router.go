package gateway

import (
	"context"
	"fmt"
	"log/slog"
	"path"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/traceform/traceform/internal/route/provider"
	"github.com/traceform/traceform/internal/route/service"
	"github.com/traceform/traceform/internal/route/store"
)

// Router handles model/provider selection for incoming gateway requests.
// It caches routing rules and providers in memory and refreshes periodically.
type Router struct {
	store         *store.Store
	encSvc        *service.Encryption
	mu            sync.RWMutex
	routes        map[string][]store.Route     // orgID -> routes
	providers     map[string][]store.Provider  // orgID -> providers
	adapters      map[string]provider.Provider // providerID -> adapter
	rrIdx         uint64
	logger        *slog.Logger
	refreshTicker *time.Ticker
	done          chan struct{}
	sfGroup       singleflight.Group           // dedup concurrent loads per org
	lastLoaded    map[string]time.Time         // orgID -> last DB load time
	orgTTL        time.Duration                // freshness window per org
}

// RoutingResult contains the outcome of a routing decision.
type RoutingResult struct {
	Adapter      provider.Provider
	ProviderID   string
	ProviderName string
	TargetModel  string
	RouteName    string
}

// NewRouter creates a new Router that refreshes its in-memory cache every 30 seconds.
func NewRouter(s *store.Store, encSvc *service.Encryption, logger *slog.Logger) *Router {
	r := &Router{
		store:         s,
		encSvc:        encSvc,
		routes:        make(map[string][]store.Route),
		providers:     make(map[string][]store.Provider),
		adapters:      make(map[string]provider.Provider),
		lastLoaded:    make(map[string]time.Time),
		orgTTL:        60 * time.Second,
		logger:        logger,
		refreshTicker: time.NewTicker(30 * time.Second),
		done:          make(chan struct{}),
	}
	go r.refreshLoop()
	return r
}

// Stop stops the background refresh loop.
func (r *Router) Stop() {
	r.refreshTicker.Stop()
	close(r.done)
}

func (r *Router) refreshLoop() {
	for {
		select {
		case <-r.refreshTicker.C:
			// Only evict orgs whose data is older than the TTL
			now := time.Now()
			r.mu.Lock()
			for orgID, loadedAt := range r.lastLoaded {
				if now.Sub(loadedAt) >= r.orgTTL {
					delete(r.routes, orgID)
					delete(r.providers, orgID)
					delete(r.lastLoaded, orgID)
				}
			}
			r.mu.Unlock()
		case <-r.done:
			return
		}
	}
}

// loadOrg ensures the in-memory cache has fresh data for the given org.
// It uses per-org TTL staleness checks and singleflight to prevent
// concurrent DB loads for the same org (thundering herd).
func (r *Router) loadOrg(ctx context.Context, orgID string) error {
	r.mu.RLock()
	if t, ok := r.lastLoaded[orgID]; ok && time.Since(t) < r.orgTTL {
		r.mu.RUnlock()
		return nil
	}
	r.mu.RUnlock()

	_, err, _ := r.sfGroup.Do("load:"+orgID, func() (interface{}, error) {
		return nil, r.loadOrgFromDB(ctx, orgID)
	})
	return err
}

// loadOrgFromDB fetches routes and providers from the database and updates
// the in-memory cache. Called via singleflight so only one goroutine per org
// hits the DB at a time.
func (r *Router) loadOrgFromDB(ctx context.Context, orgID string) error {
	routes, err := r.store.ListEnabledRoutes(ctx, orgID)
	if err != nil {
		return fmt.Errorf("load routes: %w", err)
	}

	providers, err := r.store.ListEnabledProviders(ctx, orgID)
	if err != nil {
		return fmt.Errorf("load providers: %w", err)
	}

	r.mu.Lock()
	r.routes[orgID] = routes
	r.providers[orgID] = providers
	r.lastLoaded[orgID] = time.Now()

	// Build adapters for providers not yet registered
	for _, p := range providers {
		if _, ok := r.adapters[p.ID]; !ok {
			apiKey := ""
			if r.encSvc != nil && p.APIKeyEncrypted != "" && p.APIKeyNonce != "" {
				decrypted, err := r.encSvc.Decrypt(p.APIKeyEncrypted, p.APIKeyNonce)
				if err != nil {
					r.logger.Error("decrypt provider key", "provider", p.Name, "error", err)
				} else {
					apiKey = decrypted
				}
			}
			adapter, err := provider.NewAdapter(p.Name, provider.AdapterConfig{
				APIKey:  apiKey,
				BaseURL: p.BaseURL,
			})
			if err != nil {
				r.logger.Error("create adapter", "provider", p.Name, "error", err)
				continue
			}
			r.adapters[p.ID] = adapter
		}
	}
	r.mu.Unlock()

	return nil
}

// MatchRoute finds the best matching route for a model request.
func (r *Router) MatchRoute(ctx context.Context, orgID, model string) (*RoutingResult, error) {
	if err := r.loadOrg(ctx, orgID); err != nil {
		return nil, err
	}

	r.mu.RLock()
	orgRoutes := r.routes[orgID]
	r.mu.RUnlock()

	// Find all matching routes
	var matched []store.Route
	for _, rt := range orgRoutes {
		ok, _ := path.Match(rt.ModelPattern, model)
		if ok {
			matched = append(matched, rt)
		}
	}

	if len(matched) == 0 {
		return nil, fmt.Errorf("no route found for model %q", model)
	}

	// Select provider based on strategy
	rt := r.selectByStrategy(matched)

	r.mu.RLock()
	adapter, ok := r.adapters[rt.ProviderID]
	r.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("no adapter for provider %s", rt.ProviderID)
	}

	return &RoutingResult{
		Adapter:      adapter,
		ProviderID:   rt.ProviderID,
		ProviderName: adapter.Name(),
		TargetModel:  rt.TargetModel,
		RouteName:    rt.Name,
	}, nil
}

// GetAdapter returns a cached provider adapter by provider ID.
func (r *Router) GetAdapter(providerID string) (provider.Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.adapters[providerID]
	return a, ok
}

func (r *Router) selectByStrategy(routes []store.Route) store.Route {
	if len(routes) == 1 {
		return routes[0]
	}

	strategy := routes[0].Strategy

	switch strategy {
	case "round_robin":
		idx := atomic.AddUint64(&r.rrIdx, 1)
		return routes[int(idx)%len(routes)]
	case "cost":
		sort.Slice(routes, func(i, j int) bool {
			return routes[i].Weight < routes[j].Weight
		})
		return routes[0]
	default: // priority, latency
		sort.Slice(routes, func(i, j int) bool {
			return routes[i].Priority > routes[j].Priority
		})
		return routes[0]
	}
}
