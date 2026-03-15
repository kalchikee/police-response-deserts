# Police Response Deserts — Detroit 911 Equity Analysis

**Live site:** [View on GitHub Pages](https://[username].github.io/police-response-deserts/)

An interactive web map analyzing 911 police response time inequality across Detroit census tracts using 2022 real open-data records.

---

## Key Findings

| Metric | Value |
|---|---|
| Citywide median response (all calls) | **15.6 min** |
| Citywide median response (Priority 1) | **10.1 min** |
| Response time range across tracts | 10.8 – 52.9 min |
| Calls analyzed | 279,562 (2022) |
| Tracts with data | 293 of 627 |

**Regression results (OLS, n=270 tracts, R²=0.257):**
- Distance to nearest precinct: **+0.654 min/km (p<0.001)** ★ Significant
- Median income: **−0.147 standardized (p=0.048)** ★ Significant
- % Non-white: −0.142 (p=0.068, marginal)

Lower-income tracts receive statistically slower response after controlling for station distance.

---

## Features

- **Choropleth map** — response time by census tract with 5 metric options
- **Tract detail panel** — click any tract for median, 90th pct, day/night, demographics
- **Address lookup** — type a Detroit address to find your tract's stats
- **Income vs response scatterplot** — dots colored by racial composition
- **Day/night comparison** — separate metrics for 6am–6pm and 6pm–6am
- **Equity residual layer** — which tracts get faster/slower service than the model predicts

---

## Data Sources

| Dataset | Source | Records |
|---|---|---|
| [Detroit 911 Calls for Service 2022](https://hub.arcgis.com/datasets/detroitmi::police-serviced-911-calls-2022) | Detroit Open Data Portal | 297,417 |
| [ACS 5-Year 2022](https://www.census.gov/data/developers/data-sets/acs-5year.html) | U.S. Census Bureau | 627 tracts |
| [TIGER/Line Tracts](https://tigerweb.geo.census.gov/) | U.S. Census Bureau (2020) | Wayne County |
| [Detroit Police Precincts](https://hub.arcgis.com/datasets/detroitmi::police-stations-detroit-2012) | Detroit Open Data Portal | 8 precincts |

---

## Methodology

See [`docs/methodology.md`](docs/methodology.md) for full details.

**Summary:**
1. Downloaded 297,417 calls via ArcGIS REST API (pages of 2,000)
2. Filtered to valid police dispatches with response times 0–240 min → **281,725 calls**
3. Spatial join (point-in-polygon) to Wayne County census tracts
4. Aggregated: median, 90th percentile, day/night splits per tract
5. Joined ACS demographics (race, income) and computed precinct distances
6. OLS multivariate regression to test equity predictors after controlling for operations

---

## Repository Structure

```
/
├── index.html                     # Web application entry point
├── src/
│   ├── app.js                     # Map, charts, interactions
│   └── style.css                  # Dark-theme styling
├── data/
│   └── processed/
│       ├── detroit_response_tracts.geojson  # Tract-level GeoJSON (0.6 MB)
│       ├── regression_results.json
│       ├── scatter_data.json
│       └── summary_stats.json
├── notebooks/
│   └── 01_fetch_and_process.py    # Full data pipeline
├── docs/
│   └── methodology.md
└── README.md
```

---

## Running the Data Pipeline

```bash
pip install geopandas pandas numpy scipy requests
python notebooks/01_fetch_and_process.py
```

Re-running will skip already-downloaded data (cached in `data/raw/`).

---

## Adapting to Other Cities

The methodology works for any city with open 911 data (Socrata or ArcGIS). Replace the ArcGIS service URL in `01_fetch_and_process.py`. Cities with comparable open data:
- **Dallas** — dallasopendata.com
- **Cincinnati** — data.cincinnati-oh.gov
- **New Orleans** — data.nola.gov
- **Seattle** — data.seattle.gov

---

## Tech Stack

- **Python** — pandas, geopandas, shapely, scipy (data processing)
- **Leaflet.js** — interactive choropleth map
- **Turf.js** — point-in-polygon for address lookup
- **SVG/D3-free** — custom scatterplot in vanilla SVG
- **CartoDB Dark Matter** — map tiles
- **GitHub Pages** — static hosting, no backend

---

## License

Data is public domain (US government / Detroit Open Data). Code: MIT.
