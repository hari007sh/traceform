package gateway

import (
	"sync"
	"time"
)

// CircuitState represents the state of a circuit breaker.
type CircuitState int

const (
	// CircuitClosed is the normal operating state — requests flow through.
	CircuitClosed CircuitState = iota
	// CircuitOpen means too many consecutive failures; requests are rejected for a cooldown period.
	CircuitOpen
	// CircuitHalfOpen allows a single probe request to test if the provider has recovered.
	CircuitHalfOpen
)

// String returns a human-readable label for the circuit state.
func (s CircuitState) String() string {
	switch s {
	case CircuitClosed:
		return "closed"
	case CircuitOpen:
		return "open"
	case CircuitHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

const (
	defaultFailureThreshold = 5
	defaultCooldownDuration = 30 * time.Second
)

// CircuitBreaker implements a per-provider circuit breaker.
//
// States:
//   - Closed: normal operation. Failures are counted; after failureThreshold
//     consecutive failures the breaker transitions to Open.
//   - Open: all calls are rejected (Allow returns false) for cooldownDuration.
//     After the cooldown expires the breaker moves to HalfOpen.
//   - HalfOpen: a single probe request is allowed. On success the breaker
//     returns to Closed; on failure it re-opens.
type CircuitBreaker struct {
	mu                sync.Mutex
	state             CircuitState
	consecutiveFails  int
	failureThreshold  int
	cooldownDuration  time.Duration
	openedAt          time.Time
	halfOpenRequested bool
}

// NewCircuitBreaker creates a circuit breaker with default settings
// (5 consecutive failures to open, 30 s cooldown).
func NewCircuitBreaker() *CircuitBreaker {
	return &CircuitBreaker{
		state:            CircuitClosed,
		failureThreshold: defaultFailureThreshold,
		cooldownDuration: defaultCooldownDuration,
	}
}

// Allow reports whether a request to the underlying provider should proceed.
//   - Closed  → always true
//   - Open    → false until cooldown expires, then transitions to HalfOpen and allows one probe
//   - HalfOpen → true for exactly one caller; subsequent callers are rejected until the probe completes
func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case CircuitClosed:
		return true
	case CircuitOpen:
		if time.Since(cb.openedAt) >= cb.cooldownDuration {
			cb.state = CircuitHalfOpen
			cb.halfOpenRequested = false
			// Fall through to half-open logic.
		} else {
			return false
		}
		fallthrough
	case CircuitHalfOpen:
		if !cb.halfOpenRequested {
			cb.halfOpenRequested = true
			return true
		}
		return false
	}
	return false
}

// RecordSuccess records a successful call. Resets the breaker to Closed.
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.consecutiveFails = 0
	cb.state = CircuitClosed
	cb.halfOpenRequested = false
}

// RecordFailure records a failed call. If the consecutive failure count reaches
// the threshold (and the breaker is in Closed or HalfOpen), the breaker opens.
func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.consecutiveFails++

	switch cb.state {
	case CircuitClosed:
		if cb.consecutiveFails >= cb.failureThreshold {
			cb.state = CircuitOpen
			cb.openedAt = time.Now()
		}
	case CircuitHalfOpen:
		// Probe failed — re-open immediately.
		cb.state = CircuitOpen
		cb.openedAt = time.Now()
	}
}

// State returns the current circuit state.
func (cb *CircuitBreaker) State() CircuitState {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	// If we are in Open state but the cooldown has expired, report HalfOpen
	// so callers get an accurate view without needing to call Allow first.
	if cb.state == CircuitOpen && time.Since(cb.openedAt) >= cb.cooldownDuration {
		return CircuitHalfOpen
	}
	return cb.state
}

// CircuitBreakerRegistry lazily creates and caches a CircuitBreaker per provider ID.
type CircuitBreakerRegistry struct {
	mu       sync.Mutex
	breakers map[string]*CircuitBreaker
}

// NewCircuitBreakerRegistry creates a new registry.
func NewCircuitBreakerRegistry() *CircuitBreakerRegistry {
	return &CircuitBreakerRegistry{
		breakers: make(map[string]*CircuitBreaker),
	}
}

// Get returns the CircuitBreaker for the given provider ID, creating one if necessary.
func (r *CircuitBreakerRegistry) Get(providerID string) *CircuitBreaker {
	r.mu.Lock()
	defer r.mu.Unlock()

	cb, ok := r.breakers[providerID]
	if !ok {
		cb = NewCircuitBreaker()
		r.breakers[providerID] = cb
	}
	return cb
}
