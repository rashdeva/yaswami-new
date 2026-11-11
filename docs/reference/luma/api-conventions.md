---
updatedAt: 2026-06-15T01:27:57.000Z
agentTools:
  projectIndex: https://docs.luma.com/llms.txt
---

# API Conventions

## API Path Structure

Luma API routes usually follow this pattern:

`/v{version}/{resource}/{action}`

A few older endpoints predate this structure and remain available for backward compatibility, but all current endpoints follow it.

### Components

* **Version**: The version number (e.g., `/v1/`, `/v2/`) represents the version of that **specific API route**, not the entire API. This allows us to update individual endpoints independently.
* **Resource**: The entity being operated on (e.g., `events/ticket-types`, `events`, `calendars`, `users`)
* **Action**: The operation being performed (e.g., `list`, `get`, `create`, `update`, `delete`)

## Naming Convention

The public API uses a consistent resource/action naming pattern. The `ticket-types` endpoints show the structure:

### Example: Ticket Types API

```
GET  /v1/events/ticket-types/list    # List all ticket types for an event
GET  /v1/events/ticket-types/get     # Get a single ticket type
POST /v1/events/ticket-types/create  # Create a new ticket type
POST /v1/events/ticket-types/update  # Update an existing ticket type
POST /v1/events/ticket-types/delete  # Delete a ticket type
```

### HTTP Methods

* **GET**: Used for read operations (`list`, `get`)
* **POST**: Used for write operations (`create`, `update`, `delete`)

We use POST for all write operations to maintain consistency and support complex request bodies when needed.

## Route Versioning

### Per-Route Versioning

Unlike traditional API versioning where the entire API shares a version number, Luma uses **per-route versioning**. This means:

* Each endpoint can have its own version number
* A `/v2/` route indicates that specific endpoint was updated, not the entire API
* You might use `/v1/events/list` alongside `/v2/events/create` in the same application

### Benefits

This approach provides several advantages:

1. **Gradual Migration**: Adopt new endpoint versions at your own pace
2. **Isolated Changes**: Breaking changes to one endpoint don't affect others
3. **Backward Compatibility**: Older versions remain available until deprecated
4. **Independent Evolution**: Each endpoint evolves based on its specific requirements

### Example Scenario

```javascript
// Your application might use different versions for different endpoints
const events = await fetch("/v1/events/list", options); // Still using v1
const newEvent = await fetch("/v2/events/create", eventData); // Using updated v2
const tickets = await fetch("/v1/events/ticket-types/list"); // Using v1
```