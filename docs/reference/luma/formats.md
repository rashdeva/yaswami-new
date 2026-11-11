---
updatedAt: 2025-07-27T15:37:50.000Z
agentTools:
  projectIndex: https://docs.luma.com/llms.txt
---

# API Formats

Notes on various formats and quirks.

## Dates

The Luma API uses **ISO 8601** format for all date/time values.

### Format

```
YYYY-MM-DDTHH:mm:ss.sssZ
```

### Example

```
2022-10-04T05:20:00.000Z
```

This represents October 4, 2022 at 5:20 AM UTC, which translates to:

* 1:20 AM Eastern Time
* 10:20 PM Pacific Time (October 3)

All times are stored and returned in UTC. You'll need to handle timezone conversion for your users.

## Durations

Durations also follow the **ISO 8601** format.

### Format

```
P[n]Y[n]M[n]DT[n]H[n]M[n]S
```

Where:

* `P` marks the beginning of the duration
* `Y` = years
* `M` = months (before T) or minutes (after T)
* `D` = days
* `T` = time separator
* `H` = hours
* `S` = seconds

### Example

```
P1DT12H30M
```

This represents: 1 day, 12 hours, and 30 minutes

### Recommended Library

We recommend using [Luxon](https://moment.github.io/luxon/) for handling ISO 8601 dates and durations in JavaScript/TypeScript.

## Locations

Event locations use **Google Maps Place IDs**.

### Finding a Place ID

1. Use the [Google Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id)
2. Or use the Google Maps API to search and retrieve Place IDs programmatically

### Example

```json
{
  "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4"
}
```

This Place ID uniquely identifies a specific location that can be displayed on maps and used for directions.