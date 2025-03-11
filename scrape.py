import pandas as pd
import geopandas as gpd
from shapely import wkt
import os
import json

url_zones = "https://parcheggi.comune.trento.it/static/services/registry_zones.json"
url_parks = "https://parcheggi.comune.trento.it/static/services/registry_parks.json"
parks_geoparquet = "data" + os.sep + "parks.geoparquet"
zones_geoparquet = "data" + os.sep + "zones.geoparquet"
parks_csv = "data" + os.sep + "last_parks.csv"
zones_csv = "data" + os.sep + "last_zones.csv"
def expand_stalls(df):
    stalls_df = df['stalls'].apply(pd.Series)
    for i in range(stalls_df.shape[1]):
        temp_df = stalls_df[i].apply(pd.Series)
        temp_df.columns = [f'stalls_{i}_{col}' for col in temp_df.columns]
        df = pd.concat([df, temp_df], axis=1)
    df.drop(columns=['stalls'], inplace=True)
    return df

def expand_distances(df):
    for index, row in df.iterrows():
        if 'distances' in row and row['distances']:
            distance_info = json.loads(row.distances)[0]
            distance_id = distance_info['id']
            distance_meters = distance_info['meters']
            df.at[index, f'distance_to_{distance_id}'] = distance_meters
        df.at[index, f'distance_to_{row["id"]}'] = 0
    return df

def expand_opening(df):
    for index, row in df.iterrows():
        if 'opening' in row and row['opening']:
            for d in row['opening'].keys():
                df.at[index, f'opening_{d}'] = row['opening'][d]
    return df

parks = pd.read_json(url_parks)
zones = pd.read_json(url_zones)

parks = expand_opening(parks)
del parks['distances']

for index, row in zones.iterrows():
    if 'stalls' in row:
        for stall in row.stalls:
            type = stall['type']
            capacity = stall['capacity']
            freeslots = stall['freeslots']
            ts = stall['ts'] 
            zones.at[index, 'stall_' + type + "_capacity"] = capacity
            zones.at[index, 'stall_' + type + "_freeslots"] = freeslots
            zones.at[index, 'stall_' + type + "_ts"] = ts


zones.drop(columns=['stalls'], inplace=True)
zones.fillna(0, inplace=True)

for col in zones.columns:
    if col.startswith('_ts'):
        zones[col] = pd.to_datetime(zones[col], unit='s')

# Convert the 'geom' column to geometric shapes
zones['geom'] = zones['geom'].apply(wkt.loads)
# Create a GeoDataFrame
zones = gpd.GeoDataFrame(zones, geometry='geom')
# Convert the 'geom' column to geometric shapes
parks['geom'] = parks['geom'].apply(wkt.loads)
# Create a GeoDataFrame
parks = gpd.GeoDataFrame(parks, geometry='geom')
parks = parks.set_crs(epsg=4326, inplace=True)
zones = zones.set_crs(epsg=4326, inplace=True)

zones['ts'] = pd.to_datetime(zones['ts'], unit='s')
parks['currentTimestamp'] = pd.to_datetime(parks['currentTimestamp'], unit='s')

#max_timestamp = parks.currentTimestamp.max()
#formatted_timestamp = max_timestamp.strftime('%d/%m/%Y %H:%M:%S')

if os.path.exists(zones_geoparquet) and os.path.exists(parks_geoparquet):
    zones_history = gpd.read_parquet(zones_geoparquet)
    parks_history = gpd.read_parquet(parks_geoparquet)
    if parks_history.currentTimestamp.max() > parks.currentTimestamp.max():
        parks_history = parks_history.append(parks, ignore_index=True)
        parks_history.to_parquet(parks_geoparquet, engine='pyarrow')
    if zones_history.ts.max() > zones_history.ts.max():
        zones_history = zones_history.append(zones, ignore_index=True)
        zones_history.to_parquet(zones_geoparquet, engine='pyarrow')
else:
    parks.to_parquet(parks_geoparquet, engine='pyarrow')
    zones.to_parquet(zones_geoparquet, engine='pyarrow')

del parks['geom']
del zones['geom']
#parks.to_file(parks_csv,index=False)
#zones.to_file(zones_csv,index=False)
