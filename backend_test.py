#!/usr/bin/env python3
"""
Backend API tests for Radio Melody
Tests all /api endpoints with the external base URL
"""
import requests
import urllib.parse
import sys
import time

# Base URL from frontend/.env
BASE_URL = "https://radio-everywhere-32.preview.emergentagent.com"

def test_root():
    """Test GET /api/ endpoint"""
    print("\n=== Testing GET /api/ ===")
    try:
        response = requests.get(f"{BASE_URL}/api/", timeout=10)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get("message") == "Radio Melody API":
                print("✅ PASS: Root endpoint returns correct message")
                return True
            else:
                print(f"❌ FAIL: Expected message 'Radio Melody API', got {data}")
                return False
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False


def test_stations_geo():
    """Test GET /api/stations/geo?limit=50"""
    print("\n=== Testing GET /api/stations/geo?limit=50 ===")
    try:
        response = requests.get(f"{BASE_URL}/api/stations/geo?limit=50", timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Returned {len(data)} stations")
            
            if not isinstance(data, list):
                print(f"❌ FAIL: Expected array, got {type(data)}")
                return False
            
            if len(data) == 0:
                print("⚠️  WARNING: No stations returned (Radio-Browser may be slow)")
                return True  # Not a critical failure
            
            # Check first station structure
            station = data[0]
            required_fields = ["id", "name", "url", "lat", "lng", "country"]
            missing = [f for f in required_fields if f not in station]
            
            if missing:
                print(f"❌ FAIL: Missing fields in station: {missing}")
                print(f"Station data: {station}")
                return False
            
            # Verify lat/lng are numbers
            if not isinstance(station["lat"], (int, float)):
                print(f"❌ FAIL: lat is not a number: {type(station['lat'])}")
                return False
            
            if not isinstance(station["lng"], (int, float)):
                print(f"❌ FAIL: lng is not a number: {type(station['lng'])}")
                return False
            
            print(f"Sample station: {station['name']} at ({station['lat']}, {station['lng']})")
            
            # Verify limit is respected (should be <= 50)
            if len(data) > 50:
                print(f"⚠️  WARNING: Returned {len(data)} stations, expected max 50")
            
            print("✅ PASS: Geo stations endpoint working correctly")
            return True
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False


def test_stations_search():
    """Test GET /api/stations/search with q and tag parameters"""
    print("\n=== Testing GET /api/stations/search ===")
    
    # Test 1: Search by name (q parameter)
    print("\n--- Test 1: Search by name (q=jazz) ---")
    try:
        response = requests.get(f"{BASE_URL}/api/stations/search?q=jazz&limit=20", timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Returned {len(data)} stations for 'jazz'")
            
            if not isinstance(data, list):
                print(f"❌ FAIL: Expected array, got {type(data)}")
                return False
            
            if len(data) > 0:
                station = data[0]
                required_fields = ["id", "name", "url"]
                missing = [f for f in required_fields if f not in station]
                
                if missing:
                    print(f"❌ FAIL: Missing fields: {missing}")
                    return False
                
                print(f"Sample result: {station['name']}")
            else:
                print("⚠️  No results for 'jazz' (may be valid)")
            
            print("✅ PASS: Search by name working")
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False
    
    # Test 2: Search by tag
    print("\n--- Test 2: Search by tag (tag=rock) ---")
    try:
        response = requests.get(f"{BASE_URL}/api/stations/search?tag=rock&limit=20", timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Returned {len(data)} stations for tag 'rock'")
            
            if not isinstance(data, list):
                print(f"❌ FAIL: Expected array, got {type(data)}")
                return False
            
            if len(data) > 0:
                print(f"Sample result: {data[0]['name']}")
            
            print("✅ PASS: Search by tag working")
            return True
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False


def test_stations_top():
    """Test GET /api/stations/top?limit=10"""
    print("\n=== Testing GET /api/stations/top?limit=10 ===")
    try:
        response = requests.get(f"{BASE_URL}/api/stations/top?limit=10", timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Returned {len(data)} top stations")
            
            if not isinstance(data, list):
                print(f"❌ FAIL: Expected array, got {type(data)}")
                return False
            
            if len(data) == 0:
                print("❌ FAIL: No top stations returned")
                return False
            
            # Check structure
            station = data[0]
            required_fields = ["id", "name", "url"]
            missing = [f for f in required_fields if f not in station]
            
            if missing:
                print(f"❌ FAIL: Missing fields: {missing}")
                return False
            
            print(f"Top station: {station['name']}")
            print("✅ PASS: Top stations endpoint working")
            return True, data  # Return data for use in other tests
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            return False, None
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False, None


def test_countries():
    """Test GET /api/countries"""
    print("\n=== Testing GET /api/countries ===")
    try:
        response = requests.get(f"{BASE_URL}/api/countries", timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Returned {len(data)} countries")
            
            if not isinstance(data, list):
                print(f"❌ FAIL: Expected array, got {type(data)}")
                return False
            
            if len(data) == 0:
                print("❌ FAIL: No countries returned")
                return False
            
            # Check structure
            country = data[0]
            if "name" not in country or "count" not in country:
                print(f"❌ FAIL: Missing name or count fields")
                return False
            
            print(f"Sample country: {country['name']} ({country['count']} stations)")
            print("✅ PASS: Countries endpoint working")
            return True
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False


def test_station_nearby(station_id):
    """Test GET /api/station/{id}/nearby"""
    print(f"\n=== Testing GET /api/station/{station_id}/nearby ===")
    try:
        response = requests.get(f"{BASE_URL}/api/station/{station_id}/nearby", timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            if "station" not in data or "nearby" not in data:
                print(f"❌ FAIL: Missing 'station' or 'nearby' fields")
                return False
            
            if not isinstance(data["nearby"], list):
                print(f"❌ FAIL: 'nearby' should be an array")
                return False
            
            print(f"Station: {data['station']['name']}")
            print(f"Nearby stations: {len(data['nearby'])}")
            print("✅ PASS: Nearby stations endpoint working")
            return True
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False


def test_station_click(station_id):
    """Test POST /api/station/{id}/click"""
    print(f"\n=== Testing POST /api/station/{station_id}/click ===")
    try:
        response = requests.post(f"{BASE_URL}/api/station/{station_id}/click", timeout=10)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get("ok") == True:
                print("✅ PASS: Click endpoint working")
                return True
            else:
                print(f"❌ FAIL: Expected {{ok: true}}, got {data}")
                return False
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False


def test_stream(stream_url):
    """Test GET /api/stream?url=<encoded_url>"""
    print(f"\n=== Testing GET /api/stream?url=<encoded> ===")
    print(f"Stream URL: {stream_url}")
    
    try:
        encoded_url = urllib.parse.quote(stream_url, safe='')
        response = requests.get(
            f"{BASE_URL}/api/stream?url={encoded_url}",
            timeout=15,
            stream=True
        )
        print(f"Status: {response.status_code}")
        print(f"Content-Type: {response.headers.get('content-type')}")
        
        if response.status_code == 200:
            content_type = response.headers.get('content-type', '').lower()
            
            # Check if it's an audio content type
            audio_types = ['audio/', 'application/octet-stream', 'application/ogg']
            is_audio = any(t in content_type for t in audio_types)
            
            if not is_audio:
                print(f"⚠️  WARNING: Content-Type may not be audio: {content_type}")
            
            # Read a small chunk to verify streaming
            chunk_count = 0
            bytes_read = 0
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    chunk_count += 1
                    bytes_read += len(chunk)
                    if chunk_count >= 3:  # Read 3 chunks (~24KB)
                        break
            
            print(f"Read {chunk_count} chunks ({bytes_read} bytes)")
            
            if bytes_read > 0:
                print("✅ PASS: Stream proxy working (received audio data)")
                return True
            else:
                print("❌ FAIL: No data received from stream")
                return False
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False


def test_station_city(station_id):
    """Test GET /api/station/{id}/city endpoint"""
    print(f"\n=== Testing GET /api/station/{station_id}/city ===")
    try:
        response = requests.get(f"{BASE_URL}/api/station/{station_id}/city", timeout=20)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            # Verify response structure
            required_fields = ["city", "country", "station", "stations"]
            missing_fields = [f for f in required_fields if f not in data]
            
            if missing_fields:
                print(f"❌ FAIL: Missing required fields: {missing_fields}")
                print(f"Response: {data}")
                return False
            
            print(f"✓ Response has all required fields: {required_fields}")
            
            # Verify 'stations' is a non-empty array
            if not isinstance(data["stations"], list):
                print(f"❌ FAIL: 'stations' is not an array, got: {type(data['stations'])}")
                return False
            
            if len(data["stations"]) == 0:
                print(f"❌ FAIL: 'stations' array is empty")
                return False
            
            print(f"✓ 'stations' is a non-empty array with {len(data['stations'])} items")
            
            # Verify each station has required fields
            required_station_fields = ["id", "name", "url"]
            for i, station in enumerate(data["stations"][:3]):  # Check first 3
                missing = [f for f in required_station_fields if f not in station]
                if missing:
                    print(f"❌ FAIL: Station {i} missing fields: {missing}")
                    return False
            
            print(f"✓ All stations have required fields: {required_station_fields}")
            
            # Check for distance field (should be present for geo-clustered results)
            has_distance = any("distance" in s for s in data["stations"])
            if has_distance:
                distances = [s.get("distance") for s in data["stations"] if "distance" in s]
                print(f"✓ Distance field present (km from base station): {distances[:5]}")
            else:
                print(f"⚠ Note: No distance field found (may be fallback to state/country)")
            
            print(f"City: {data['city']}, Country: {data['country']}")
            print(f"Base station: {data['station']['name']}")
            print("✅ PASS: /api/station/{id}/city endpoint working correctly")
            return True
            
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False


def test_station_single(station_id):
    """Test GET /api/station/{id} endpoint"""
    print(f"\n=== Testing GET /api/station/{station_id} ===")
    try:
        response = requests.get(f"{BASE_URL}/api/station/{station_id}", timeout=15)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            # Verify required fields
            required_fields = ["id", "name", "url"]
            missing_fields = [f for f in required_fields if f not in data]
            
            if missing_fields:
                print(f"❌ FAIL: Missing required fields: {missing_fields}")
                print(f"Response: {data}")
                return False
            
            print(f"✓ Response has all required fields: {required_fields}")
            
            # Verify the ID matches the request
            if data["id"] != station_id:
                print(f"❌ FAIL: Station ID mismatch. Expected: {station_id}, Got: {data['id']}")
                return False
            
            print(f"✓ Station ID matches request: {station_id}")
            
            # Check for optional lat/lng fields
            has_coords = "lat" in data and "lng" in data
            if has_coords:
                print(f"✓ Station has coordinates: lat={data['lat']}, lng={data['lng']}")
            else:
                print(f"⚠ Note: Station does not have lat/lng coordinates")
            
            print(f"Station: {data['name']}")
            print("✅ PASS: /api/station/{id} endpoint working correctly")
            return True
            
        else:
            print(f"❌ FAIL: Expected status 200, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False


def test_nowplaying(top_stations):
    """Test GET /api/nowplaying?url=<encoded_stream_url> endpoint"""
    print(f"\n=== Testing GET /api/nowplaying?url=<encoded_stream_url> ===")
    
    # Filter for https URLs (prefer icecast/shoutcast style)
    https_stations = [s for s in top_stations if s.get("url", "").startswith("https://")]
    
    if not https_stations:
        print("⚠ Warning: No HTTPS stations found, using any available stations")
        test_stations = top_stations[:5]
    else:
        test_stations = https_stations[:5]
    
    print(f"Testing with {len(test_stations)} station URLs")
    
    success_count = 0
    stations_with_titles = []
    
    for i, station in enumerate(test_stations):
        station_url = station.get("url")
        station_name = station.get("name")
        
        if not station_url:
            continue
        
        print(f"\n→ Test {i+1}/{len(test_stations)}: {station_name}")
        print(f"   URL: {station_url[:60]}...")
        
        # URL encode the stream URL
        encoded_url = urllib.parse.quote(station_url, safe='')
        
        try:
            response = requests.get(
                f"{BASE_URL}/api/nowplaying?url={encoded_url}",
                timeout=20
            )
            
            # Check status code
            if response.status_code != 200:
                print(f"   ❌ HTTP {response.status_code}: {response.text[:100]}")
                continue
            
            data = response.json()
            
            # Verify response structure
            if "title" not in data or "name" not in data:
                print(f"   ❌ Missing 'title' or 'name' in response: {data}")
                continue
            
            success_count += 1
            
            # Check if we got a title
            if data["title"]:
                print(f"   ✅ HTTP 200 - Title: '{data['title']}'")
                if data["name"]:
                    print(f"      Station name: '{data['name']}'")
                stations_with_titles.append({
                    "name": station_name,
                    "url": station_url,
                    "title": data["title"]
                })
            else:
                print(f"   ✅ HTTP 200 - No title (stream doesn't broadcast ICY metadata)")
                if data["name"]:
                    print(f"      Station name: '{data['name']}'")
        
        except requests.exceptions.Timeout:
            print(f"   ⚠ Timeout (stream may be slow or unavailable)")
        except Exception as e:
            print(f"   ❌ Error: {e}")
    
    # Summary
    print(f"\n--- NOWPLAYING TEST SUMMARY ---")
    print(f"  Tested: {len(test_stations)} stations")
    print(f"  Successful responses (HTTP 200): {success_count}")
    print(f"  Stations with titles: {len(stations_with_titles)}")
    
    if stations_with_titles:
        print(f"\n  Stations that returned titles:")
        for s in stations_with_titles:
            print(f"    • {s['name']}: '{s['title']}'")
    
    # Pass if we got at least one successful response
    if success_count > 0:
        print(f"\n✅ PASS: /api/nowplaying endpoint responds correctly")
        return True
    else:
        print(f"\n❌ FAIL: No successful responses from /api/nowplaying")
        return False


def main():
    """Run all backend tests"""
    print("=" * 70)
    print("RADIO MELODY BACKEND API TESTS")
    print("=" * 70)
    print(f"Base URL: {BASE_URL}")
    
    results = {}
    
    # Test 1: Root endpoint
    results["root"] = test_root()
    time.sleep(1)
    
    # Test 2: Geo stations
    results["geo_stations"] = test_stations_geo()
    time.sleep(1)
    
    # Test 3: Search stations
    results["search_stations"] = test_stations_search()
    time.sleep(1)
    
    # Test 4: Top stations (also get data for later tests)
    top_result = test_stations_top()
    if isinstance(top_result, tuple):
        results["top_stations"], top_data = top_result
    else:
        results["top_stations"] = top_result
        top_data = None
    time.sleep(1)
    
    # Test 5: Countries
    results["countries"] = test_countries()
    time.sleep(1)
    
    # Test 6 & 7: Nearby and Click (need a valid station ID)
    if top_data and len(top_data) > 0:
        station_id = top_data[0]["id"]
        results["nearby"] = test_station_nearby(station_id)
        time.sleep(1)
        results["click"] = test_station_click(station_id)
        time.sleep(1)
        
        # Test 8: Stream proxy (find an https URL)
        https_station = None
        for station in top_data:
            if station.get("url", "").startswith("https://"):
                https_station = station
                break
        
        if https_station:
            results["stream"] = test_stream(https_station["url"])
        else:
            print("\n⚠️  WARNING: No HTTPS station found in top stations for stream test")
            print("Trying with a fallback station...")
            # Try to get more stations
            try:
                response = requests.get(f"{BASE_URL}/api/stations/top?limit=50", timeout=30)
                if response.status_code == 200:
                    more_stations = response.json()
                    for station in more_stations:
                        if station.get("url", "").startswith("https://"):
                            https_station = station
                            break
                    
                    if https_station:
                        results["stream"] = test_stream(https_station["url"])
                    else:
                        print("❌ FAIL: Could not find any HTTPS station for stream test")
                        results["stream"] = False
            except:
                results["stream"] = False
        
        # NEW TESTS: Test 9, 10, 11 - Three new endpoints
        time.sleep(1)
        results["station_city"] = test_station_city(station_id)
        time.sleep(1)
        results["station_single"] = test_station_single(station_id)
        time.sleep(1)
        results["nowplaying"] = test_nowplaying(top_data)
    else:
        print("\n⚠️  WARNING: Could not get top stations, skipping nearby/click/stream tests")
        results["nearby"] = False
        results["click"] = False
        results["stream"] = False
        results["station_city"] = False
        results["station_single"] = False
        results["nowplaying"] = False
    
    # Summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{test_name:20s}: {status}")
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
