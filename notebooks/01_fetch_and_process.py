"""
Detroit Police 911 Response Time Equity Analysis
Data Fetching and Processing Pipeline
"""

import requests, json, time, os, math
import pandas as pd
import numpy as np
import geopandas as gpd
from shapely.geometry import Point, shape
from scipy import stats

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR  = os.path.join(BASE_DIR, "data", "raw")
PROC_DIR = os.path.join(BASE_DIR, "data", "processed")

# ── 1. Download Detroit 911 calls 2022 ─────────────────────────────────────

def fetch_911_calls():
    out_path = os.path.join(RAW_DIR, "detroit_911_2022.parquet")
    if os.path.exists(out_path):
        print("  [SKIP] 911 calls already downloaded")
        return pd.read_parquet(out_path)

    base = ("https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services"
            "/Police_Serviced_911_Calls_2022_View/FeatureServer/0/query")
    offset, page_size, records = 0, 2000, []
    print("  Downloading 911 calls (this may take a few minutes)...")
    while True:
        params = {
            "where": "1=1",
            "outFields": "*",
            "resultOffset": offset,
            "resultRecordCount": page_size,
            "f": "json",
        }
        for attempt in range(3):
            try:
                r = requests.get(base, params=params, timeout=30)
                d = r.json()
                break
            except Exception as e:
                if attempt == 2:
                    raise
                time.sleep(2)

        feats = d.get("features", [])
        if not feats:
            break
        for f in feats:
            records.append(f["attributes"])
        offset += page_size
        if offset % 20000 == 0:
            print(f"    {offset:,} records downloaded...")
        if len(feats) < page_size:
            break

    df = pd.DataFrame(records)
    df.to_parquet(out_path, index=False)
    print(f"  Downloaded {len(df):,} records")
    return df

# ── 2. Download Detroit census tracts ─────────────────────────────────────

def fetch_census_tracts():
    out_path = os.path.join(RAW_DIR, "detroit_tracts.geojson")
    if os.path.exists(out_path):
        gdf = gpd.read_file(out_path)
        # If previously downloaded block groups (12-digit GEOID), re-download
        if len(gdf) > 0 and len(str(gdf["GEOID"].iloc[0])) > 11:
            print("  Re-downloading census tracts (replacing block groups)...")
            os.remove(out_path)
        else:
            print("  [SKIP] Census tracts already downloaded")
            return gdf

    print("  Downloading Wayne County census tracts from Census TIGER...")
    # Use Census TIGER cartographic boundary file API (census tracts = layer 0)
    url = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
           "Tracts_Blocks/MapServer/0/query")
    params = {
        "where": "STATE='26' AND COUNTY='163'",
        "outFields": "GEOID,TRACT,NAME",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": 2000,
    }
    r = requests.get(url, params=params, timeout=45)
    gdf = gpd.read_file(r.text)
    gdf.to_file(out_path, driver="GeoJSON")
    print(f"  Downloaded {len(gdf)} census tracts")
    return gdf


# ── 3. Download ACS demographics ───────────────────────────────────────────

def fetch_acs():
    out_path = os.path.join(RAW_DIR, "acs_wayne_county.json")
    if os.path.exists(out_path):
        print("  [SKIP] ACS data already downloaded")
        with open(out_path) as f:
            return json.load(f)

    print("  Downloading ACS 5-year 2022 demographics...")
    # B03002: Hispanic or Latino Origin by Race (for % non-white)
    # B19013: Median Household Income
    # B01003: Total Population
    # B01001: Sex by Age (population density proxy)
    variables = "B03002_001E,B03002_003E,B19013_001E,B01003_001E"
    url = (f"https://api.census.gov/data/2022/acs/acs5"
           f"?get=NAME,{variables}&for=tract:*&in=state:26+county:163")
    r = requests.get(url, timeout=30)
    data = r.json()
    with open(out_path, "w") as f:
        json.dump(data, f)
    print(f"  Downloaded ACS data for {len(data)-1} tracts")
    return data


# ── 4. Download Detroit police stations ────────────────────────────────────

def fetch_police_stations():
    out_path = os.path.join(RAW_DIR, "detroit_police_stations.geojson")
    if os.path.exists(out_path):
        print("  [SKIP] Police stations already downloaded")
        return gpd.read_file(out_path)

    print("  Downloading Detroit police station locations...")
    # Search ArcGIS Hub for Detroit police precincts
    url = "https://hub.arcgis.com/api/v3/datasets?q=detroit+police+precincts&page[size]=5"
    r = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
    data = r.json()
    station_url = None
    for item in data.get("data", []):
        attrs = item.get("attributes", {})
        if "detroit" in attrs.get("name", "").lower() or "detroitmi" in attrs.get("slug", "").lower():
            station_url = attrs.get("url")
            print(f"    Found: {attrs.get('name')} -> {station_url}")
            break

    if station_url:
        r2 = requests.get(station_url + "/query?where=1%3D1&outFields=*&f=geojson", timeout=20)
        gdf = gpd.read_file(r2.text)
    else:
        # Hardcode Detroit police precinct locations (from public records)
        stations = {
            "name": ["1st Precinct", "2nd Precinct", "3rd Precinct", "4th Precinct",
                     "5th Precinct", "6th Precinct", "7th Precinct", "8th Precinct",
                     "9th Precinct", "11th Precinct", "12th Precinct"],
            "lat":  [42.3398, 42.3960, 42.3720, 42.3515, 42.4051, 42.3631, 42.3943,
                     42.3832, 42.4183, 42.3610, 42.3783],
            "lon":  [-83.0482, -83.1104, -83.0857, -83.0243, -83.0626, -83.1561,
                     -82.9962, -82.9731, -83.0168, -83.0954, -83.1263],
        }
        gdf = gpd.GeoDataFrame(
            pd.DataFrame(stations),
            geometry=[Point(lon, lat) for lon, lat in zip(stations["lon"], stations["lat"])],
            crs="EPSG:4326"
        )

    gdf.to_file(out_path, driver="GeoJSON")
    print(f"  Saved {len(gdf)} police stations")
    return gdf


# ── 5. Process data ────────────────────────────────────────────────────────

def process_data(df_raw, tracts_gdf, acs_raw, stations_gdf):
    print("\n=== Processing Data ===")

    # --- Clean 911 data ---
    df = df_raw.copy()
    # Filter: valid coords, valid response times, priority 1-3
    df = df.dropna(subset=["latitude", "longitude", "total_response_time"])
    df = df[(df["latitude"] != 0) & (df["longitude"] != 0)]
    df = df[df["total_response_time"] > 0]
    df = df[df["total_response_time"] <= 240]  # remove >4 hr outliers
    df["priority"] = df["priority"].astype(str).str.strip()
    df = df[df["priority"].isin(["1", "2", "3"])]

    # Convert called_at to datetime
    df["called_at"] = pd.to_datetime(df["called_at"], unit="ms")
    df["hour"] = df["called_at"].dt.hour
    df["is_day"] = df["hour"].between(6, 17)  # 6AM-6PM = day shift

    print(f"  Cleaned: {len(df):,} valid calls (from {len(df_raw):,})")

    # --- Spatial join to census tracts ---
    print("  Spatial joining calls to census tracts...")
    calls_gdf = gpd.GeoDataFrame(
        df,
        geometry=[Point(xy) for xy in zip(df["longitude"], df["latitude"])],
        crs="EPSG:4326"
    )
    tracts_proj = tracts_gdf.to_crs("EPSG:4326")
    joined = gpd.sjoin(calls_gdf, tracts_proj[["GEOID", "geometry"]], how="left", predicate="within")
    print(f"  Joined. Matched: {joined['GEOID'].notna().sum():,} / {len(joined):,}")

    # --- ACS demographics ---
    print("  Processing ACS demographics...")
    headers = acs_raw[0]
    rows = acs_raw[1:]
    acs_df = pd.DataFrame(rows, columns=headers)
    # TIGER census tract GEOID = state(2) + county(3) + tract(6) = 11 chars
    acs_df["GEOID_short"] = acs_df["state"] + acs_df["county"] + acs_df["tract"]
    acs_df["total_pop"] = pd.to_numeric(acs_df["B01003_001E"], errors="coerce")
    acs_df["white_alone"] = pd.to_numeric(acs_df["B03002_003E"], errors="coerce")
    acs_df["total_race"] = pd.to_numeric(acs_df["B03002_001E"], errors="coerce")
    acs_df["median_income"] = pd.to_numeric(acs_df["B19013_001E"], errors="coerce")
    acs_df["pct_nonwhite"] = ((acs_df["total_race"] - acs_df["white_alone"]) /
                               acs_df["total_race"].replace(0, np.nan) * 100)
    acs_df["median_income"] = acs_df["median_income"].replace(-666666666, np.nan)

    # --- Aggregate 911 by tract ---
    print("  Aggregating response times by census tract...")

    def agg_tract(grp):
        p1 = grp[grp["priority"] == "1"]["total_response_time"]
        all_r = grp["total_response_time"]
        day_r = grp[grp["is_day"]]["total_response_time"]
        night_r = grp[~grp["is_day"]]["total_response_time"]
        return pd.Series({
            "median_response_all":    all_r.median(),
            "p90_response_all":       all_r.quantile(0.9),
            "median_response_p1":     p1.median() if len(p1) > 0 else np.nan,
            "p90_response_p1":        p1.quantile(0.9) if len(p1) > 0 else np.nan,
            "median_response_day":    day_r.median() if len(day_r) > 0 else np.nan,
            "median_response_night":  night_r.median() if len(night_r) > 0 else np.nan,
            "call_volume":            len(grp),
            "call_volume_p1":         len(p1),
        })

    tract_stats = joined.groupby("GEOID").apply(agg_tract).reset_index()

    # Match GEOID format between TIGER and stats
    # TIGER census tract GEOIDs are 11 chars: state(2)+county(3)+tract(6)
    # The spatial join uses whatever GEOID the tracts have
    tract_ids = tracts_proj["GEOID"].dropna()
    sample_id = str(tract_ids.iloc[0]) if len(tract_ids) > 0 else ""
    print(f"  Sample tract GEOID: {sample_id} (len={len(sample_id)})")
    tract_stats = tract_stats.rename(columns={"GEOID": "GEOID_stats"})

    # --- Distance to nearest police station ---
    print("  Computing distance to nearest police station...")
    tracts_m = tracts_proj.copy().to_crs("EPSG:3857")
    stations_m = stations_gdf.to_crs("EPSG:3857")
    tracts_m["centroid"] = tracts_m.geometry.centroid

    def nearest_station_dist(centroid):
        dists = stations_m.geometry.distance(centroid)
        return dists.min() / 1000  # km

    tracts_m["dist_to_station_km"] = tracts_m["centroid"].apply(nearest_station_dist)

    # --- Join everything ---
    print("  Joining all datasets...")
    tracts_final = tracts_proj.copy()
    tracts_final = tracts_final.merge(tract_stats, left_on="GEOID", right_on="GEOID_stats", how="left")

    # Merge ACS
    acs_merge = acs_df[["GEOID_short", "total_pop", "pct_nonwhite", "median_income"]].copy()
    acs_merge.columns = ["GEOID_short", "total_pop", "pct_nonwhite", "median_income"]
    tracts_final = tracts_final.merge(acs_merge, left_on="GEOID", right_on="GEOID_short", how="left")

    # Add station distance
    tracts_final = tracts_final.merge(
        tracts_m[["GEOID", "dist_to_station_km"]].rename(columns={"GEOID": "GEOID_dist"}),
        left_on="GEOID", right_on="GEOID_dist", how="left"
    )

    # Compute tract area (km²) for population density
    tracts_area = tracts_proj.to_crs("EPSG:3857").copy()
    tracts_area["area_km2"] = tracts_area.geometry.area / 1e6
    tracts_final = tracts_final.merge(
        tracts_area[["GEOID", "area_km2"]].rename(columns={"GEOID": "GEOID_area"}),
        left_on="GEOID", right_on="GEOID_area", how="left"
    )
    tracts_final["pop_density"] = tracts_final["total_pop"] / tracts_final["area_km2"].replace(0, np.nan)

    # Drop rows with no 911 data
    tracts_analysis = tracts_final.dropna(subset=["median_response_all", "pct_nonwhite", "median_income"])
    print(f"  Analysis dataset: {len(tracts_analysis)} tracts with full data")

    # --- Regression analysis ---
    print("  Running multivariate regression...")

    def safe_norm(series):
        mn, sd = series.mean(), series.std()
        return (series - mn) / sd if sd > 0 else series * 0

    reg_df = tracts_analysis[["median_response_p1", "pct_nonwhite", "median_income",
                               "call_volume", "dist_to_station_km", "pop_density",
                               "total_pop", "GEOID"]].dropna().copy()

    # Normalize
    for col in ["pct_nonwhite", "median_income", "call_volume",
                "dist_to_station_km", "pop_density"]:
        reg_df[col + "_z"] = safe_norm(reg_df[col])

    # OLS: response_time ~ nonwhite + income + call_vol + dist_station + pop_density
    from numpy.linalg import lstsq
    y = reg_df["median_response_p1"].values
    X = np.column_stack([
        np.ones(len(reg_df)),
        reg_df["pct_nonwhite_z"].values,
        reg_df["median_income_z"].values,
        reg_df["call_volume_z"].values,
        reg_df["dist_to_station_km_z"].values,
        reg_df["pop_density_z"].values,
    ])
    coefs, residuals_sum, rank, sv = lstsq(X, y, rcond=None)
    y_pred = X @ coefs
    residuals = y - y_pred

    # R² and p-values via scipy
    slope_labels = ["intercept", "pct_nonwhite", "median_income",
                    "call_volume", "dist_station", "pop_density"]
    n, k = len(y), X.shape[1]
    sse = np.sum(residuals**2)
    sst = np.sum((y - y.mean())**2)
    r_squared = 1 - sse / sst
    mse = sse / (n - k)
    var_coef = mse * np.linalg.inv(X.T @ X).diagonal()
    se = np.sqrt(var_coef)
    t_stats = coefs / se
    p_values = [2 * (1 - stats.t.cdf(abs(t), df=n-k)) for t in t_stats]

    reg_results = {
        "r_squared": round(float(r_squared), 4),
        "n_tracts": int(n),
        "coefficients": {
            label: {
                "coef": round(float(c), 4),
                "se":   round(float(s), 4),
                "t":    round(float(t), 3),
                "p":    round(float(p), 4),
                "significant": float(p) < 0.05
            }
            for label, c, s, t, p in zip(slope_labels, coefs, se, t_stats, p_values)
        }
    }
    print(f"  R² = {r_squared:.3f}")
    for lbl, info in reg_results["coefficients"].items():
        sig = "**" if info["significant"] else ""
        print(f"    {lbl:20s}: coef={info['coef']:7.3f}  p={info['p']:.4f} {sig}")

    # Add regression residual back to tracts (faster vs slower than expected)
    reg_df["equity_residual"] = residuals
    tracts_final = tracts_final.merge(
        reg_df[["GEOID", "equity_residual"]],
        on="GEOID", how="left"
    )

    # --- Quintile classification ---
    for col, qcol in [("median_response_all", "response_quintile"),
                      ("median_income", "income_quintile"),
                      ("pct_nonwhite", "nonwhite_quintile")]:
        valid = tracts_final[col].dropna()
        if len(valid) > 5:
            tracts_final[qcol] = pd.qcut(tracts_final[col], q=5,
                                          labels=[1,2,3,4,5], duplicates="drop").astype("Int64")

    return tracts_final, reg_results, joined


def save_outputs(tracts_final, reg_results, calls_joined):
    print("\n=== Saving Outputs ===")

    # Round float columns to reduce file size
    float_cols = tracts_final.select_dtypes(include="float64").columns
    tracts_final[float_cols] = tracts_final[float_cols].round(2)

    # Select columns for GeoJSON
    keep_cols = [
        "GEOID", "NAME", "geometry",
        "median_response_all", "p90_response_all",
        "median_response_p1",  "p90_response_p1",
        "median_response_day", "median_response_night",
        "call_volume", "call_volume_p1",
        "pct_nonwhite", "median_income", "total_pop", "pop_density",
        "dist_to_station_km", "equity_residual",
        "response_quintile", "income_quintile", "nonwhite_quintile",
    ]
    keep_cols = [c for c in keep_cols if c in tracts_final.columns]
    out_gdf = tracts_final[keep_cols].copy()

    # Save full GeoJSON
    geojson_path = os.path.join(PROC_DIR, "detroit_response_tracts.geojson")
    out_gdf.to_file(geojson_path, driver="GeoJSON")
    size_mb = os.path.getsize(geojson_path) / 1e6
    print(f"  GeoJSON saved: {geojson_path} ({size_mb:.2f} MB)")

    # Save regression results
    reg_path = os.path.join(PROC_DIR, "regression_results.json")
    with open(reg_path, "w") as f:
        json.dump(reg_results, f, indent=2)
    print(f"  Regression results: {reg_path}")

    # Save scatterplot data (one row per tract)
    scatter_cols = ["GEOID", "NAME", "median_response_p1", "pct_nonwhite",
                    "median_income", "call_volume", "total_pop", "equity_residual",
                    "response_quintile"]
    scatter_cols = [c for c in scatter_cols if c in tracts_final.columns]
    scatter_df = tracts_final[scatter_cols].dropna(subset=["median_response_p1"])
    scatter_path = os.path.join(PROC_DIR, "scatter_data.json")
    scatter_df.to_json(scatter_path, orient="records", indent=2)
    print(f"  Scatter data: {scatter_path} ({len(scatter_df)} tracts)")

    # Save summary stats
    summary = {
        "citywide_median_response_all":  round(float(tracts_final["median_response_all"].median()), 1),
        "citywide_median_response_p1":   round(float(tracts_final["median_response_p1"].median()), 1),
        "citywide_median_response_day":  round(float(tracts_final["median_response_day"].median()), 1),
        "citywide_median_response_night":round(float(tracts_final["median_response_night"].median()), 1),
        "total_tracts_analyzed":         int(tracts_final["median_response_all"].notna().sum()),
        "total_calls_2022":              int(tracts_final["call_volume"].sum()),
        "data_year": 2022,
        "city": "Detroit, MI",
    }
    summary_path = os.path.join(PROC_DIR, "summary_stats.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"  Summary stats: {summary_path}")
    print(f"\n  Citywide median response (all): {summary['citywide_median_response_all']} min")
    print(f"  Citywide median response (P1):  {summary['citywide_median_response_p1']} min")


# ── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Detroit 911 Response Time Equity Analysis ===\n")
    print("=== Phase 1: Fetching Data ===")
    df_raw       = fetch_911_calls()
    tracts_gdf   = fetch_census_tracts()
    acs_raw      = fetch_acs()
    stations_gdf = fetch_police_stations()

    print("\n=== Phase 2: Processing ===")
    tracts_final, reg_results, calls_joined = process_data(df_raw, tracts_gdf, acs_raw, stations_gdf)

    save_outputs(tracts_final, reg_results, calls_joined)
    print("\n=== Done ===")
