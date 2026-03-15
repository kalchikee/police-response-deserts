# Methodology — Detroit Police Response Desert Analysis

## Research Question

How much variation exists in actual police 911 response times across Detroit census tracts, and does that variation correlate with racial composition and median income after controlling for operational factors (call density, station proximity)?

## Study Area

Detroit, Michigan — Wayne County census tracts. Detroit was selected for:
- Complete, publicly available 911 call-for-service records through the Detroit Open Data Portal
- Extreme neighborhood-level demographic variation (ideal for equity analysis)
- Well-documented history of public safety resource allocation debates

## Data Acquisition

### 911 Calls for Service
- **Source:** Detroit Open Data Portal via ArcGIS REST API
- **Dataset:** "Police Serviced 911 Calls 2022"
- **URL:** `https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Police_Serviced_911_Calls_2022_View/FeatureServer/0`
- **Raw records:** 297,417
- **Fields used:** `total_response_time` (minutes), `priority` (1/2/3), `latitude`, `longitude`, `called_at` (timestamp)

### Census Tract Boundaries
- **Source:** Census TIGER/Line via TIGERweb MapServer
- **Geography:** Wayne County census tracts (FIPS: 26163)
- **Year:** 2020 Census tracts
- **Count:** 627 tracts

### ACS Demographics
- **Source:** American Community Survey 5-Year Estimates, 2022
- **Variables:**
  - `B03002_001E` — Total population (for race denominator)
  - `B03002_003E` — White alone, not Hispanic
  - `B19013_001E` — Median household income
  - `B01003_001E` — Total population
- **Geography:** Tract level, Wayne County, Michigan

### Police Precincts
- **Source:** Detroit Open Data Portal
- **Dataset:** "Police Stations, Detroit, 2012"
- **Records:** 8 precinct locations

## Processing Steps

### 1. Data Cleaning
- Removed calls with missing coordinates or response times
- Filtered to response times 0–240 minutes (removes negative values and likely data errors >4 hours)
- Retained priority 1, 2, and 3 calls
- **Final: 281,725 valid calls**

### 2. Temporal Classification
- Day shift: 6am–6pm (hour 6–17)
- Night shift: 6pm–6am (hour 18–5)
- Based on `called_at` timestamp (milliseconds → UTC)

### 3. Spatial Join
- Created point geometries from `latitude`/`longitude` columns
- Used geopandas `sjoin` (predicate: within) to assign each call to a census tract
- **Matched: 279,562 / 281,725 calls** (99.2%)

### 4. Tract Aggregation
For each census tract, calculated:
- `median_response_all` — median response time, all calls
- `p90_response_all` — 90th percentile, all calls
- `median_response_p1` — median response time, Priority 1 only
- `p90_response_p1` — 90th percentile, Priority 1 only
- `median_response_day` — median response time, daytime calls
- `median_response_night` — median response time, nighttime calls
- `call_volume` — total calls per tract
- `call_volume_p1` — Priority 1 calls per tract

### 5. Distance to Nearest Precinct
- Projected all geometries to EPSG:3857 (meters)
- Computed tract centroid
- Found minimum Euclidean distance to any precinct centroid
- Converted to kilometers

### 6. Equity Regression Model

**Dependent variable:** `median_response_p1` (tract median Priority 1 response time)

**Independent variables (all standardized to z-scores):**
- `pct_nonwhite` — (total_race − white_alone) / total_race × 100
- `median_income` — ACS B19013
- `call_volume` — total calls per tract
- `dist_to_station_km` — distance to nearest precinct
- `pop_density` — total population / tract area (km²)

**Method:** OLS via numpy `lstsq`, t-statistics and p-values via scipy.stats.t

**Results:**

| Variable | Coef (std) | p-value | Significant? |
|---|---|---|---|
| Intercept | 10.133 | <0.001 | ★ |
| % Non-white | −0.142 | 0.068 | Marginal |
| Median income | −0.147 | 0.048 | ★ |
| Call volume | +0.029 | 0.693 | No |
| Dist. to precinct | +0.654 | <0.001 | ★ |
| Pop. density | −0.012 | 0.869 | No |

**R² = 0.257** (model explains 26% of variance in tract response times)

### 7. Equity Residual
For each tract, `equity_residual = observed − predicted`.
- **Positive** = tract receives slower service than the model predicts given its income, demographics, and station distance → potential service deficit
- **Negative** = tract receives faster service than predicted

## Limitations

1. **Response time definition:** `total_response_time` in the dataset is dispatch_time + travel_time; it includes queuing delay before a unit is assigned, not just travel. True travel time would require separate dispatch/arrival timestamps.
2. **2022 only:** Single year; results may not represent multi-year trends.
3. **Wayne County tracts:** Includes suburban Wayne County tracts with few calls; analysis focuses on tracts with sufficient call volume.
4. **No call priority weighting:** Regression uses Priority 1 response as dependent variable to hold call type constant.
5. **Ecological analysis:** Tract-level; individual-level disparities cannot be inferred.

## Reproduction

All code in `notebooks/01_fetch_and_process.py`. Requirements: Python 3.9+, geopandas, pandas, numpy, scipy, requests.

```bash
python notebooks/01_fetch_and_process.py
```
