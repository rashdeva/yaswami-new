---
updatedAt: 2026-06-15T01:28:00.000Z
agentTools:
  projectIndex: https://docs.luma.com/llms.txt
---

# Getting Started

Make your first request in just a few minutes.

## About the API

The Luma API is a JSON-based API that allows you to programmatically manage your events and guests.

**Base URL**: `https://public-api.luma.com`

## Requirements

To use the Luma API, you need a **Luma Plus** subscription.

## Creating an API Key

API keys are scoped to a single calendar. Each calendar you want to manage via the API needs its own key, and each key only grants access to the calendar it was created on.

1. Go to [luma.com/calendar/manage/api-keys](https://luma.com/calendar/manage/api-keys) and select the calendar you want a key for
2. Generate an API key
3. Store it securely

> **Warning**: Be careful with this API key since it grants full access to the calendar it's scoped to.

## Authentication

Authenticate your requests by including your API key in the `x-luma-api-key` header.

### Example: Test Authentication

```bash
curl -H "x-luma-api-key: $LUMA_API_KEY" https://public-api.luma.com/v1/users/get-self
```

This will return information about the authenticated user if the API key is valid.

## OpenAPI Spec

The full OpenAPI 3.1 specification is available at:

```
https://public-api.luma.com/openapi.json
```

No authentication is required. You can use this to generate client libraries, import into tools like Postman, or build integrations with AI agents.

## Next Steps

* Review the [API Conventions](api-conventions) guide to understand our routing and versioning approach
* Review the [API Formats](formats) guide to understand date, duration, and location formatting
* Check out [code examples](examples) for implementation ideas
* Explore the API endpoints in the reference documentation