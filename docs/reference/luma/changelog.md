---
updatedAt: 2026-11-05T03:08:07.000Z
agentTools:
  projectIndex: https://docs.luma.com/llms.txt
---

# Changelog

All notable changes to the Luma Public API.

## November 2026

**Added:** `is_ticket_key_invalidated` on `GET /v1/events/guests/get`. It’s `true` when `id` is a ticket key whose ticket has been removed, transferred, or refunded, so check-in systems can reject the scan even if the guest holds another valid ticket.

## October 2026

**Changed:** `POST /v1/calendars/events/reject` only emails the submitter when you pass `notify_submitter: true` or a `message`. Previously every rejection emailed the submitter.

**Added:** `create_meeting` on event create and update. Pass `"zoom"` or `"google-meet"` to have Luma create a meeting with the Zoom or Google account the API key's user has connected; the join link is saved as the event's `meeting_url`, which you can read from `GET /v1/events/get`. Can't be combined with `meeting_url` or `geo_address_json`.

## September 2026

**Added:** `POST /v1/calendars/admins/add` to add calendar admins by email. Adds that would need more paid Luma Plus admin seats are rejected; add those admins in the Luma app.

**Added:** `POST /v2/organizations/calendars/create` accepts `location`, `launch_status`, `website`, and social handles, in the same formats as `POST /v1/calendars/update`.

**Added:** `tax_config` on event create, update, and `GET /v1/events/get` to set tax for a single event, overriding the calendar's tax setting.

**Added:** `POST /v1/calendars/update` accepts `location`, `website`, and social handles.

**Added:** `GET /v1/memberships/tiers/list` now includes hidden tiers, marked with `is_hidden`, and `POST /v1/memberships/members/add` can add members to them.

**Added:** Blast endpoints: `GET /v1/events/blasts/list`, `GET /v1/events/blasts/get`, `POST /v1/events/blasts/create`, `POST /v1/events/blasts/update`, and `POST /v1/events/blasts/delete`.

**Added:** `geo_address_json` on event create and update accepts `{ type: "lookup", query }`, which resolves the query to the top Google Maps result. If nothing matches, the query is stored as a manual address.

**Added:** `GET /v1/places/search` to look up places on Google Maps by name or address. Pass the chosen `place_id` as `geo_address_json: { type: "google", place_id }` when creating or updating an event.

**Added:** `GET /v1/images/search` to search Luma's gallery of event cover images by keyword. Pass the chosen `image_url` as `cover_url` when creating or updating an event.

**Changed:** `cents` and `min_cents` on ticket type create and update must be non-negative integers.

**Added:** `confirmation_email_md`, `pending_approval_email_md`, and `declined_email_md` on event create and update, and on `GET /v1/events/get` for events you manage. Each sets your message inside Luma's standard email; an empty string removes it.

**Changed:** `suppress_notifications` on `POST /v1/events/update` is deprecated in favor of `suppress_email`. Both now skip only the guest email; guests still get a push notification for a changed time or location.

## August 2026

**Added:** Contact entries from `GET /v1/calendars/contacts/list` now include `registration_answers` on the `membership` object — the member’s answers to their tier’s registration questions.

**Added:** Tier entries from `GET /v1/memberships/tiers/list` now include `registration_questions` — the questions members answer when joining the tier.

## July 2026

**Added:** `POST /v1/events/guests/update-tickets` to grant complimentary tickets or invalidate existing tickets without charging or refunding the guest.

**Changed:** Event list entries no longer include `description` and `description_md` — `GET /v1/calendars/events/list`, `GET /v1/organizations/events/list`, and the legacy `GET /v1/calendar/list-events` omit them. Fetch event descriptions with `GET /v1/events/get`.

## June 2026

**Added:** `POST /v1/calendars/contacts/block`, `POST /v1/calendars/contacts/remove`, and `POST /v1/calendars/contacts/restore` to moderate calendar contacts. Block stops someone from following your calendar or joining its events; remove opts them out of invites and newsletters but lets them follow again later; restore returns a blocked or removed contact to active. Each takes a `contact_id` (the `id` from `contacts/list`) or an `email`.

**Added:** New flat-response endpoints that return single-object fields at the top level and list results under `entries` instead of nesting them under a named key. Migrate to these for a cleaner response shape:

* `GET /v1/calendars/get` (replaces `GET /v1/calendar/get`)
* `GET /v1/events/guests/get` (replaces `GET /v1/event/get-guest`)
* `GET /v1/users/get-self` (replaces `GET /v1/user/get-self`)
* `GET /v1/events/ticket-types/list` (replaces `GET /v1/event/ticket-types/list`; entries are now under `entries`)
* `GET /v1/events/ticket-types/get` (replaces `GET /v1/event/ticket-types/get`)
* `POST /v1/events/ticket-types/create` (replaces `POST /v1/event/ticket-types/create`)
* `POST /v1/events/ticket-types/update` (replaces `POST /v1/event/ticket-types/update`)
* `POST /v1/events/coupons/create` (replaces `POST /v1/event/create-coupon`)
* `POST /v1/calendars/coupons/create` (replaces `POST /v1/calendar/coupons/create`)
* `GET /v1/events/get` (replaces `GET /v1/event/get`; hosts are now returned on the event object)
* `GET /v1/events/guests/list` (replaces `GET /v1/event/get-guests`; entries no longer include the deprecated nested `guest` copy)
* `GET /v1/calendars/events/list` (replaces `GET /v1/calendar/list-events`; entries no longer include the deprecated nested `event` copy)
* `POST /v1/events/create` (replaces `POST /v1/event/create`)
* `POST /v1/events/update` (replaces `POST /v1/event/update`)
* `POST /v1/events/cancel/request` and `POST /v1/events/cancel` (replace the `/v1/event/cancel/*` equivalents)
* `GET /v2/webhooks/get`, `POST /v2/webhooks/create`, `POST /v2/webhooks/update` (replace the `/v1/webhooks/*` equivalents)
* `POST /v2/organizations/calendars/create` (replaces `POST /v1/organizations/calendars/create`)
* `GET /v1/events/coupons/list` (replaces `GET /v1/event/coupons`) and `POST /v1/events/coupons/update` (replaces `POST /v1/event/update-coupon`)
* `GET /v1/calendars/coupons/list` (replaces `GET /v1/calendar/coupons`) and `POST /v1/calendars/coupons/update` (replaces `POST /v1/calendar/coupons/update`)
* `POST /v1/events/guests/add` (replaces `POST /v1/event/add-guests`)
* `POST /v1/events/guests/update-status` (replaces `POST /v1/event/update-guest-status`; takes a single `guest_id` — guest ID, ticket key, guest key, or email — instead of the `guest` object)
* `POST /v1/events/guests/send-invites` (replaces `POST /v1/event/send-invites`)
* `POST /v1/events/hosts/add`, `POST /v1/events/hosts/update`, `POST /v1/events/hosts/remove` (replace the `/v1/event/hosts/*` equivalents)
* `POST /v1/events/ticket-types/delete` (replaces `POST /v1/event/ticket-types/delete`)
* `GET /v1/calendars/events/lookup`, `POST /v1/calendars/events/add`, `POST /v1/calendars/events/approve`, and `POST /v1/calendars/events/reject` (replace the `/v1/calendar/{lookup,add,approve,reject}-event` equivalents)
* `/v1/calendars/event-tags/` `create`, `update`, `delete`, `apply`, `unapply`, and `list` (replace the `/v1/calendar/event-tags/*` equivalents; `create` returns `id`, `update`/`delete` take `tag_id`, `apply`/`unapply` take `event_ids`, and list entries drop the deprecated `api_id`)
* `GET /v1/calendars/admins/list` (replaces `GET /v1/calendar/admins/list`; entries drop the deprecated `api_id`)
* `GET /v1/entities/lookup` (replaces `GET /v1/entity/lookup`; the entity drops the deprecated `api_id`)

The new endpoints also drop the deprecated compatibility fields from their responses — `api_id` (use `id`), `user_api_id`, `calendar_api_id`, `zoom_meeting_url`, `geo_latitude`/`geo_longitude`, and the guest-level `event_ticket`, `custom_source`, and `checked_in_at`. Use the current field names instead (e.g. `coordinate`, `event_tickets`, per-ticket `checked_in_at`).

The replaced endpoints keep working and still return their original nested shape (e.g. `{ event, hosts }`, `{ calendar }`, `{ guest }`, `{ ticket_type }`, `{ webhook }`, `{ coupon }`, `{ user }`) including the deprecated fields, but are no longer listed in the docs. New integrations should use the endpoints above.

## May 2026

**Changed:** Renamed calendar people endpoints to contacts: `GET /v1/calendars/contacts/list`, `POST /v1/calendars/contacts/import`, and contact tag endpoints under `/v1/calendars/contact-tags/`.

**Changed:** The new contact routes use cleaned fields like `contacts`, `tags`, `membership_status`, `tag_id`, and `user_ids`; contact tag creation now returns `id`. Old people/person-tag paths still work with their old parameter names for backwards compatibility.

**Changed:** Simplified ticket type schemas for `GET /v1/event/ticket-types/list`, `GET /v1/event/ticket-types/get`, `POST /v1/event/ticket-types/create`, and `POST /v1/event/ticket-types/update`. Ticket type responses now document `id` as the identifier and `type` as `free` or `paid`. Responses still include the deprecated `api_id` field for backwards compatibility, but new integrations should use `id`.

## April 2026

**Changed:** Flattened paginated list entries for `GET /v1/calendar/list-events` and `GET /v1/event/get-guests`. Event and guest fields now appear at the top level of each entry instead of being nested under an `event` / `guest` key. The nested objects are still returned for backwards compatibility but are deprecated — new integrations should read fields directly off the entry.

**Changed:** Standardized identifier naming across all endpoints. Request parameters now use `event_id` instead of `event_api_id` (and similarly for other entities like `event_ticket_type_id`). Response objects now return `id` instead of `api_id`. The old names are still accepted/returned but deprecated.

## March 2026

**Added:** `utm_source` field on the Guest object, replacing `custom_source` (which is now deprecated). Contains the UTM source parameter captured when the guest registered.

**Added:** `GET /v1/calendar/get` endpoint to retrieve info about the calendar associated with your API key.

## February 2026

**Added:** Two-step event cancellation via `POST /v1/event/cancel/request` and `POST /v1/event/cancel`. Returns guest count and whether the event has paid guests before confirming, with optional refunds for paid events.

**Added:** `POST /v1/event/hosts/update` and `POST /v1/event/hosts/remove` endpoints for managing event hosts. The existing add-host endpoint is now also available at `POST /v1/event/hosts/create`.

**Added:** Event tag management endpoints: `POST /v1/calendar/event-tags/create`, `POST /v1/calendar/event-tags/update`, `POST /v1/calendar/event-tags/delete`, `POST /v1/calendar/event-tags/apply`, and `POST /v1/calendar/event-tags/unapply`.

## January 2026

**Added:** `terms` registration question type for events. Supports both markdown content (`content_md`) and link-based terms.

**Added:** `skip_payment` flag on `POST /v1/memberships/members/add` to add members to paid tiers without requiring payment through Luma.

**Added:** `suppress_notifications` parameter on `POST /v1/event/update` to update an event without notifying guests.

## December 2025

**Added:** Webhook management endpoints: `POST /v1/webhooks/create`, `POST /v1/webhooks/update`, and `POST /v1/webhooks/delete`.

**Added:** Membership management endpoints: `GET /v1/memberships/tiers/list`, `POST /v1/memberships/members/add`, and `POST /v1/memberships/members/update-status`.