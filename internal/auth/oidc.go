package auth

import (
	"context"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// NewOIDCProvider creates a new OIDC provider using OpenID Connect discovery
// on the given issuer URL (e.g. "https://accounts.google.com").
func NewOIDCProvider(ctx context.Context, issuerURL string) (*oidc.Provider, error) {
	provider, err := oidc.NewProvider(ctx, issuerURL)
	if err != nil {
		return nil, fmt.Errorf("OIDC discovery for %s: %w", issuerURL, err)
	}
	return provider, nil
}

// BuildOAuth2Config constructs an oauth2.Config from the OIDC provider's
// discovered endpoint, the client credentials, redirect URL, and requested scopes.
func BuildOAuth2Config(provider *oidc.Provider, clientID, clientSecret, redirectURL string, scopes []string) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     provider.Endpoint(),
		RedirectURL:  redirectURL,
		Scopes:       scopes,
	}
}

// OIDCClaims represents the standard claims extracted from an OIDC ID token.
type OIDCClaims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Sub           string `json:"sub"`
}

// ExchangeAndVerify exchanges the authorization code for tokens, verifies
// the ID token, and extracts the user's email and name claims.
func ExchangeAndVerify(ctx context.Context, provider *oidc.Provider, oauth2Cfg *oauth2.Config, code string) (email, name string, err error) {
	// Exchange the authorization code for an OAuth2 token.
	token, err := oauth2Cfg.Exchange(ctx, code)
	if err != nil {
		return "", "", fmt.Errorf("exchange authorization code: %w", err)
	}

	// Extract the raw ID token from the OAuth2 token.
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return "", "", fmt.Errorf("no id_token in token response")
	}

	// Create a verifier configured for this client ID.
	verifier := provider.Verifier(&oidc.Config{
		ClientID: oauth2Cfg.ClientID,
	})

	// Verify the ID token signature and claims.
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return "", "", fmt.Errorf("verify ID token: %w", err)
	}

	// Extract standard claims.
	var claims OIDCClaims
	if err := idToken.Claims(&claims); err != nil {
		return "", "", fmt.Errorf("extract ID token claims: %w", err)
	}

	if claims.Email == "" {
		return "", "", fmt.Errorf("ID token did not contain an email claim")
	}

	return claims.Email, claims.Name, nil
}
