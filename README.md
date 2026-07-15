# parklogtrento
parklogtrento monitors the availability of car and bicycle parking spaces in Trento. \
It periodically queries public APIs and updates some geoparquet files, creating a time series for historical analysis and forecasting.

![](https://napo.github.io/parklogtrento/images/logo.svg)

The website with the availability of the parking spaces made by the municipality of Trento is here\
https://parcheggi.comune.trento.it/

## Sampling cadence (important for anyone reusing the data)

The scraper is meant to record the situation **every 5 minutes**.

Until July 2026 the timing was delegated to the GitHub Actions scheduler, which is explicitly
best-effort: measured on the collected data itself (Duomo car park, 490 days), the real cadence
was **about 21 minutes (median)**, with 68% of the gaps above 15 minutes, 9% above one hour and a
largest gap of 55.8 hours. Since July 2026 the workflow no longer relies on the cron: a single
hourly run loops internally waiting 300 seconds between readings, so the 5-minute step is now real.

If you use the historical series, please account for this: the sampling is **irregular**, so
aggregate (e.g. hourly) rather than assuming a fixed 5-minute grid.
