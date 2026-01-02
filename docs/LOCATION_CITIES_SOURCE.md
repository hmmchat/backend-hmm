# Location Feature - Where Cities Come From

## Overview

The location feature uses cities from **two different sources** depending on the use case:

## 1. Cities with Maximum Users (`GET /location/cities`)

**Source:** User database (PostgreSQL)

**How it works:**
- Queries the `users` table in the database
- Extracts all cities from the `preferredCities` array field of all users
- Counts how many users have each city in their preferred cities list
- Returns cities sorted by user count (descending)
- Also provides `onlineCount` and `chattingCount` for each city

**Database Query:**
```sql
SELECT 
  unnest("preferredCities") as city,
  COUNT(*)::int as count
FROM users
WHERE array_length("preferredCities", 1) > 0
  AND "profileCompleted" = true
GROUP BY city
ORDER BY count DESC
LIMIT {limit}
```

**Example Response:**
```json
[
  {
    "city": "Mumbai",
    "userCount": 150,
    "onlineCount": 120,
    "chattingCount": 30
  },
  {
    "city": "Delhi",
    "userCount": 140,
    "onlineCount": 110,
    "chattingCount": 30
  }
]
```

**When to use:**
- Showing users which cities have the most active users
- Helping users discover popular locations
- Default city list on the location selection screen

---

## 2. City Search (`GET /location/search?q=mumbai`)

**Source:** OpenStreetMap Nominatim API (External)

**API:** `https://nominatim.openstreetmap.org`

**How it works:**
- Makes a request to OpenStreetMap's Nominatim geocoding API
- Searches for cities matching the query string
- Filters results to only include cities (not other location types)
- Extracts city name, country, and state from the API response
- Returns unique cities (removes duplicates)

**API Request:**
```
GET https://nominatim.openstreetmap.org/search?
  q=mumbai&
  format=json&
  limit=20&
  addressdetails=1&
  featuretype=city
```

**Example Response:**
```json
[
  {
    "city": "Mumbai",
    "country": "India",
    "state": "Maharashtra"
  },
  {
    "city": "Mumbai",
    "country": "Pakistan",
    "state": "Sindh"
  }
]
```

**When to use:**
- User searches for a specific city by name
- Finding cities that might not be in the database yet
- Getting city details (country, state) for display

**Note:** This is a free API but has rate limits. For production, consider:
- Caching search results
- Using a paid geocoding service (Google Maps, Mapbox)
- Maintaining a local city database

---

## 3. Locate Me (`POST /location/locate-me`)

**Source:** OpenStreetMap Nominatim API (External) - Reverse Geocoding

**API:** `https://nominatim.openstreetmap.org`

**How it works:**
- Takes latitude and longitude coordinates from the user's device
- Makes a reverse geocoding request to Nominatim API
- Converts coordinates to a city name
- Returns the city, country, and state

**API Request:**
```
GET https://nominatim.openstreetmap.org/reverse?
  lat=19.0760&
  lon=72.8777&
  format=json&
  addressdetails=1
```

**Example Response:**
```json
{
  "city": "Mumbai",
  "country": "India",
  "state": "Maharashtra"
}
```

**When to use:**
- User clicks "Locate me" button
- Automatically detecting user's current city
- Setting default preferred city based on location

---

## Summary

| Endpoint | City Source | Purpose |
|----------|-------------|---------|
| `GET /location/cities` | **Database** (user's preferredCities) | Show popular cities with most users |
| `GET /location/search?q=...` | **OpenStreetMap API** | Search for any city by name |
| `POST /location/locate-me` | **OpenStreetMap API** (reverse geocoding) | Get city from GPS coordinates |

## Data Flow

1. **Initial State:** Database is empty (no cities)
2. **User Action:** User searches for "Mumbai" → Gets city from OpenStreetMap API
3. **User Selection:** User selects "Mumbai" → Saved to `preferredCities` array in database
4. **Popular Cities:** Other users see "Mumbai" in the popular cities list (from database)
5. **Growth:** As more users select cities, the database becomes the primary source for popular cities

## Configuration

The geocoding API URL can be configured via environment variable:
```bash
GEOCODING_API_URL=https://nominatim.openstreetmap.org  # Default
```

For production, you might want to use:
- Google Maps Geocoding API
- Mapbox Geocoding API
- Azure Maps Geocoding
- Or maintain a local city database

