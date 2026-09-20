#!/usr/bin/env python3
"""
Backend API tests for Radio Melody
Focused test: /api/img endpoint + regression sanity checks
"""
import requests
import urllib.parse
import sys

# Base URL from frontend/.env
BASE_URL = "https://radio-everywhere-32.preview.emergentagent.com/api"

def test_img_proxy():
    """Test the new /api/img endpoint - image proxy with CORS"""
    print("\n=== Testing GET /api/img (NEW ENDPOINT) ===")
    
    # Step 1: Get a station with a favicon from /api/stations/top
    print("Step 1: Fetching top stations to find a favicon URL...")
    try:
        resp = requests.get(f"{BASE_URL}/stations/top", params={"limit": 15}, timeout=15)
        resp.raise_for_status()
        stations = resp.json()
        print(f"✓ Got {len(stations)} top stations")
    except Exception as e:
        print(f"✗ FAIL: Could not fetch top stations: {e}")
        return False
    
    # Step 2: Find a station with a non-empty https favicon
    favicon_url = None
    station_name = None
    for station in stations:
        fav = station.get("favicon", "")
        if fav and fav.startswith("https://"):
            favicon_url = fav
            station_name = station.get("name", "Unknown")
            break
    
    if not favicon_url:
        print("✗ FAIL: No station with https favicon found in top 15")
        return False
    
    print(f"✓ Found favicon for station '{station_name}': {favicon_url[:60]}...")
    
    # Step 3: URL-encode the favicon and request via /api/img
    encoded_favicon = urllib.parse.quote(favicon_url, safe='')
    img_url = f"{BASE_URL}/img?url={encoded_favicon}"
    print(f"Step 2: Requesting /api/img?url=<encoded>...")
    
    try:
        resp = requests.get(img_url, timeout=15)
        status = resp.status_code
        content_type = resp.headers.get("content-type", "")
        cors_header = resp.headers.get("access-control-allow-origin", "")
        
        print(f"  Status: {status}")
        print(f"  Content-Type: {content_type}")
        print(f"  CORS Header: {cors_header}")
        
        # Check requirements
        if status != 200:
            print(f"✗ Expected status 200, got {status}")
            # Try another favicon if 404 or 502 (remote fetch failed)
            if status in [404, 502] and len(stations) > 1:
                print("  Trying other favicons...")
                for station in stations[1:]:
                    fav = station.get("favicon", "")
                    if fav and fav.startswith("https://"):
                        encoded_fav = urllib.parse.quote(fav, safe='')
                        retry_url = f"{BASE_URL}/img?url={encoded_fav}"
                        try:
                            retry_resp = requests.get(retry_url, timeout=15)
                            if retry_resp.status_code == 200:
                                status = 200
                                content_type = retry_resp.headers.get("content-type", "")
                                cors_header = retry_resp.headers.get("access-control-allow-origin", "")
                                print(f"  ✓ Retry succeeded with station '{station.get('name')}'")
                                print(f"    Status: {status}, Content-Type: {content_type}, CORS: {cors_header}")
                                break
                        except Exception as e:
                            continue
        
        if status != 200:
            print(f"✗ FAIL: All favicons failed, last status: {status}")
            return False
        
        if not content_type.startswith("image/"):
            print(f"✗ FAIL: Expected content-type starting with 'image/', got '{content_type}'")
            return False
        
        if cors_header != "*":
            print(f"✗ FAIL: Expected CORS header 'Access-Control-Allow-Origin: *', got '{cors_header}'")
            return False
        
        print(f"✅ PASS: /api/img endpoint works correctly")
        print(f"   - Returns HTTP 200")
        print(f"   - Content-Type is image/* ({content_type})")
        print(f"   - CORS header present: Access-Control-Allow-Origin: *")
        return True
        
    except Exception as e:
        print(f"✗ FAIL: Error requesting /api/img: {e}")
        return False


def test_regression_geo():
    """Regression: GET /api/stations/geo?limit=10"""
    print("\n=== Regression Test: GET /api/stations/geo ===")
    try:
        resp = requests.get(f"{BASE_URL}/stations/geo", params={"limit": 10}, timeout=15)
        resp.raise_for_status()
        stations = resp.json()
        
        if not isinstance(stations, list):
            print(f"✗ FAIL: Expected array, got {type(stations)}")
            return False
        
        if len(stations) == 0:
            print("✗ FAIL: Expected at least 1 station, got 0")
            return False
        
        # Check structure
        first = stations[0]
        if not isinstance(first.get("lat"), (int, float)) or not isinstance(first.get("lng"), (int, float)):
            print(f"✗ FAIL: Expected numeric lat/lng, got lat={type(first.get('lat'))}, lng={type(first.get('lng'))}")
            return False
        
        print(f"✅ PASS: /api/stations/geo returns {len(stations)} stations with numeric lat/lng")
        return True
        
    except Exception as e:
        print(f"✗ FAIL: {e}")
        return False


def test_regression_search():
    """Regression: GET /api/stations/search?q=jazz&limit=5"""
    print("\n=== Regression Test: GET /api/stations/search ===")
    try:
        resp = requests.get(f"{BASE_URL}/stations/search", params={"q": "jazz", "limit": 5}, timeout=15)
        resp.raise_for_status()
        stations = resp.json()
        
        if not isinstance(stations, list):
            print(f"✗ FAIL: Expected array, got {type(stations)}")
            return False
        
        if len(stations) == 0:
            print("✗ FAIL: Expected at least 1 station, got 0")
            return False
        
        print(f"✅ PASS: /api/stations/search?q=jazz returns {len(stations)} stations")
        return True
        
    except Exception as e:
        print(f"✗ FAIL: {e}")
        return False


def test_regression_nowplaying():
    """Regression: GET /api/nowplaying?url=<encoded_url>"""
    print("\n=== Regression Test: GET /api/nowplaying ===")
    
    # First get a top station URL
    try:
        resp = requests.get(f"{BASE_URL}/stations/top", params={"limit": 5}, timeout=15)
        resp.raise_for_status()
        stations = resp.json()
        
        if not stations:
            print("✗ FAIL: No stations returned from /api/stations/top")
            return False
        
        station_url = stations[0].get("url")
        station_name = stations[0].get("name", "Unknown")
        
        if not station_url:
            print("✗ FAIL: Station has no URL")
            return False
        
        print(f"Testing with station: {station_name}")
        
        # Now test nowplaying
        encoded_url = urllib.parse.quote(station_url, safe='')
        resp = requests.get(f"{BASE_URL}/nowplaying", params={"url": encoded_url}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        
        if not isinstance(data, dict):
            print(f"✗ FAIL: Expected JSON object, got {type(data)}")
            return False
        
        if "title" not in data or "name" not in data:
            print(f"✗ FAIL: Expected {{title, name}} structure, got {data.keys()}")
            return False
        
        print(f"✅ PASS: /api/nowplaying returns correct structure {{title: {data.get('title')}, name: {data.get('name')}}}")
        return True
        
    except Exception as e:
        print(f"✗ FAIL: {e}")
        return False


def main():
    print("=" * 70)
    print("Radio Melody Backend API Tests")
    print("Focused test: /api/img + regression sanity checks")
    print("=" * 70)
    
    results = {
        "NEW /api/img (image proxy with CORS)": test_img_proxy(),
        "REGRESSION /api/stations/geo": test_regression_geo(),
        "REGRESSION /api/stations/search": test_regression_search(),
        "REGRESSION /api/nowplaying": test_regression_nowplaying(),
    }
    
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "✗ FAIL"
        print(f"{status}: {test_name}")
    
    all_passed = all(results.values())
    print("\n" + "=" * 70)
    if all_passed:
        print("✅ ALL TESTS PASSED")
    else:
        print("✗ SOME TESTS FAILED")
    print("=" * 70)
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
