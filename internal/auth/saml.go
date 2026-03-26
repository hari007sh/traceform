package auth

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/crewjam/saml"
	"github.com/crewjam/saml/samlsp"
)

// Common SAML attribute names used by identity providers for email and name.
var (
	samlEmailAttributes = []string{
		"email",
		"Email",
		"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
		"urn:oid:0.9.2342.19200300.100.1.3",
		"mail",
	}
	samlNameAttributes = []string{
		"displayName",
		"name",
		"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
		"urn:oid:2.16.840.1.113730.3.1.241",
		"cn",
		"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
		"givenName",
	}
)

// NewSAMLServiceProvider creates a SAML ServiceProvider from the SSO config
// and the application base URL. It parses the IdP metadata XML to configure
// the SP for this identity provider.
func NewSAMLServiceProvider(cfg *SSOConfig, baseURL string) (*saml.ServiceProvider, error) {
	if cfg.IDPMetadataXML == "" {
		return nil, fmt.Errorf("IdP metadata XML is required for SAML configuration")
	}

	idpMetadata, err := samlsp.ParseMetadata([]byte(cfg.IDPMetadataXML))
	if err != nil {
		return nil, fmt.Errorf("parse IdP metadata: %w", err)
	}

	parsedBase, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse base URL: %w", err)
	}

	metadataURL := *parsedBase
	metadataURL.Path = "/auth/saml/metadata"

	acsURL := *parsedBase
	acsURL.Path = "/auth/saml/acs"

	// Override SP entity ID and ACS URL from config if present
	entityID := metadataURL.String()
	if cfg.SPEntityID != "" {
		entityID = cfg.SPEntityID
	}
	if cfg.SPACSURL != "" {
		parsed, err := url.Parse(cfg.SPACSURL)
		if err == nil {
			acsURL = *parsed
		}
	}

	sp := &saml.ServiceProvider{
		EntityID:    entityID,
		AcsURL:      acsURL,
		MetadataURL: metadataURL,
		IDPMetadata: idpMetadata,
	}

	return sp, nil
}

// HandleSAMLACS parses the SAML response from the HTTP request and extracts
// the user's email and display name from the assertion attributes.
// The possibleRequestIDs parameter can be nil to skip request ID validation
// (common for IdP-initiated SSO).
func HandleSAMLACS(sp *saml.ServiceProvider, r *http.Request) (email, name string, err error) {
	// Parse the SAML response. Pass nil for possibleRequestIDs to support
	// both SP-initiated and IdP-initiated flows.
	assertion, err := sp.ParseResponse(r, []string{""})
	if err != nil {
		return "", "", fmt.Errorf("parse SAML response: %w", err)
	}

	email = findSAMLAttribute(assertion, samlEmailAttributes)
	name = findSAMLAttribute(assertion, samlNameAttributes)

	// Fall back to the NameID if email was not found in attributes
	if email == "" && assertion.Subject != nil && assertion.Subject.NameID != nil {
		nameID := assertion.Subject.NameID.Value
		if strings.Contains(nameID, "@") {
			email = nameID
		}
	}

	if email == "" {
		return "", "", fmt.Errorf("SAML assertion did not contain an email attribute")
	}

	return email, name, nil
}

// findSAMLAttribute searches the assertion's attribute statements for the first
// matching attribute name and returns its value.
func findSAMLAttribute(assertion *saml.Assertion, names []string) string {
	for _, stmt := range assertion.AttributeStatements {
		for _, attr := range stmt.Attributes {
			for _, target := range names {
				if strings.EqualFold(attr.Name, target) || strings.EqualFold(attr.FriendlyName, target) {
					if len(attr.Values) > 0 && attr.Values[0].Value != "" {
						return attr.Values[0].Value
					}
				}
			}
		}
	}
	return ""
}
