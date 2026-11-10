# address_to_stl

California address -> STL using USGS 3DEP lidar (public AWS EPT, no API key).

```n pip install -r requirements.txt
python address_to_stl.py "Oakland City Hall, Oakland CA" -r 200 -o city_hall.stl
```

-r = half-width in meters (square area). Also: --res, --size, --vscale, --veg.
