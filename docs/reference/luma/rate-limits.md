---
updatedAt: 2026-07-29T09:43:33.000Z
agentTools:
  projectIndex: https://docs.luma.com/llms.txt
---

# Rate Limits

The API uses a per-minute rate limit shared across GET and POST requests:

* **Calendar API keys** and OAuth tokens: **200 requests per minute** per calendar
* **Organization API keys**: **500 requests per minute** per organization

When you exceed the limit, you'll receive a `429 Too Many Requests` response and be blocked for 1 minute. Handle these responses gracefully and back off before retrying.

## Rate Limit Headers

Authenticated, rate-limited API responses include headers describing your current rate limit status:

| Header                  | Description                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| `X-RateLimit-Limit`     | Maximum requests allowed per minute                                       |
| `X-RateLimit-Remaining` | Requests remaining in the current window                                  |
| `X-RateLimit-Reset`     | Window reset timestamp on successful responses; block expiration on `429` |
| `Retry-After`           | Only on `429` responses - seconds to wait before retrying                 |

Use `X-RateLimit-Remaining` to pace your requests, and honor `Retry-After` when you receive a `429`.

These limits are subject to change. For higher limits, contact <support@luma.com>.