import pandas as pd
import geopandas as gpd
from shapely import wkt
import os
import json

URL_ZONES = "https://parcheggi.comune.trento.it/static/services/registry_zones.json"
URL_PARKS = "https://parcheggi.comune.trento.it/static/services/registry_parks.json"
PARKS_GEOPARQUET = "data" + os.sep + "parks.geoparquet"
ZONES_GEOPARQUET = "data" + os.sep + "zones.geoparquet"
PARKS_CSV = "data" + os.sep + "last_parks.csv"
ZONES_CSV = "data" + os.sep + "last_zones.csv"

def expand_stalls(df):
    """
    Expands the 'stalls' column in the given DataFrame into separate columns.

    The 'stalls' column is expected to contain dictionaries or lists. Each key or index in these
    dictionaries/lists will be expanded into its own column in the DataFrame. The new columns will
    be named using the pattern 'stalls_{i}_{key}', where 'i' is the index of the dictionary/list
    in the original 'stalls' column, and 'key' is the key or index from the dictionary/list.

    Parameters:
    df (pandas.DataFrame): The input DataFrame containing a 'stalls' column to be expanded.

    Returns:
    pandas.DataFrame: The DataFrame with the 'stalls' column expanded into separate columns.
    """
    stalls_df = df['stalls'].apply(pd.Series)
    for i in range(stalls_df.shape[1]):
        temp_df = stalls_df[i].apply(pd.Series)
        temp_df.columns = [f'stalls_{i}_{col}' for col in temp_df.columns]
        df = pd.concat([df, temp_df], axis=1)
    df.drop(columns=['stalls'], inplace=True)
    return df

def expand_distances(df):
    """
    Expands the 'distances' column in the DataFrame by creating new columns for each distance.

    For each row in the DataFrame, if the 'distances' column contains JSON data, the function
    extracts the first distance information and creates a new column named 'distance_to_<id>'
    where <id> is the ID from the distance information. The value of this new column is set to
    the distance in meters. Additionally, a column 'distance_to_<row_id>' is created for each row
    with a value of 0.

    Args:
        df (pandas.DataFrame): The input DataFrame containing a 'distances' column with JSON data.

    Returns:
        pandas.DataFrame: The modified DataFrame with new distance columns added.
    """
    for idx, dist_row in df.iterrows():
        if 'distances' in dist_row and dist_row['distances']:
            distance_info = json.loads(dist_row.distances)[0]
            if 'id' in distance_info and 'meters' in distance_info:
                distance_id = distance_info['id']
                distance_meters = distance_info['meters']
                df.at[idx, f'distance_to_{distance_id}'] = distance_meters
                df.at[idx, f'distance_to_{dist_row["id"]}'] = 0
    return df

def expand_opening(df):
    """
    Expands the 'opening' column in the DataFrame into separate columns for each day.

    Parameters:
    df (pandas.DataFrame): 
    The input DataFrame containing an 'opening' column with dictionary values.

    Returns:
    pandas.DataFrame: 
    The modified DataFrame with new columns for each day in the 'opening' dictionary.
    """
    for idx, opening_row in df.iterrows():
        if 'opening' in opening_row and opening_row['opening']:
            for d in opening_row['opening'].keys():
                df.at[idx, f'opening_{d}'] = opening_row['opening'][d]
    return df

parks = pd.read_json(URL_PARKS)
zones = pd.read_json(URL_ZONES)

parks = expand_opening(parks)
del parks['distances']

for index, row in zones.iterrows():
    if 'stalls' in row:
        for stall in row.stalls:
            stalltype = stall['type']
            capacity = stall['capacity']
            freeslots = stall['freeslots']
            ts = stall['ts'] 
            zones.at[index, 'stall_' + stalltype + "_capacity"] = capacity
            zones.at[index, 'stall_' + stalltype + "_freeslots"] = freeslots
            zones.at[index, 'stall_' + stalltype + "_ts"] = ts


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
if os.path.exists(ZONES_GEOPARQUET) and os.path.exists(PARKS_GEOPARQUET):
    zones_history = gpd.read_parquet(ZONES_GEOPARQUET)
    parks_history = gpd.read_parquet(PARKS_GEOPARQUET)
    if parks_history.currentTimestamp.max() < parks.currentTimestamp.max():
        parks_history = gpd.GeoDataFrame(pd.concat([parks_history, parks], ignore_index=True))
        parks_history.to_parquet(PARKS_GEOPARQUET, engine='pyarrow')
        print("new parks create " + str(parks.currentTimestamp.max()))
    if zones_history.ts.max() < zones.ts.max():
        zones_history = gpd.GeoDataFrame(pd.concat([zones_history, zones], ignore_index=True))
        to_int = ['stall_blu_capacity','stall_blu_freeslots',
          'stall_carico-scarico_capacity','stall_carico-scarico_freeslots',
          'stall_disabili_capacity','stall_disabili_freeslots']
        zones_history[to_int] = zones_history[to_int].astype(int)
        zones_history.to_parquet(ZONES_GEOPARQUET, engine='pyarrow')
        print("new zones create " + str(zones_history.ts.max()))

else:
    parks.to_parquet(PARKS_GEOPARQUET, engine='pyarrow')
    zones.to_parquet(ZONES_GEOPARQUET, engine='pyarrow')

del parks['geom']
del zones['geom']
parks.to_csv(PARKS_CSV,index=False)
zones.to_csv(ZONES_CSV,index=False)
