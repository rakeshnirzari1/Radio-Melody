from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime
import httpx
import random
import urllib.parse
import re
import math


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p = math.pi / 180
    a = (0.5 - math.cos((lat2 - lat1) * p) / 2 +
         math.cos(lat1 * p) * math.cos(lat2 * p) *
         (1 - math.cos((lon2 - lon1) * p)) / 2)
    return 2 * R * math.asin(math.sqrt(max(0.0, a)))

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Radio Melody API")
api_router = APIRouter(prefix="/api")

# ---- Radio Browser configuration ----
RB_SERVERS = [
    "https://de1.api.radio-browser.info",
    "https://de2.api.radio-browser.info",
    "https://at1.api.radio-browser.info",
    "https://nl1.api.radio-browser.info",
]
RB_HEADERS = {"User-Agent": "RadioMelody/1.0 (radio.garden clone)"}


def rb_base() -> str:
    return random.choice(RB_SERVERS)


async def rb_get(path: str, params: dict = None):
    """GET from radio-browser with server fallback."""
    last_err = None
    servers = RB_SERVERS.copy()
    random.shuffle(servers)
    async with httpx.AsyncClient(timeout=20.0, headers=RB_HEADERS, follow_redirects=True) as c:
        for base in servers:
            try:
                r = await c.get(f"{base}{path}", params=params)
                r.raise_for_status()
                return r.json()
            except Exception as e:  # noqa
                last_err = e
                continue
    raise HTTPException(status_code=502, detail=f"Radio Browser unavailable: {last_err}")


# ---- Models ----
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class StatusCheckCreate(BaseModel):
    client_name: str


@api_router.get("/")
async def root():
    return {"message": "Radio Melody API"}


@api_router.get("/stations/geo")
async def stations_geo(limit: int = 8000):
    """Stations that have geo coordinates, for placing on the globe."""
    data = await rb_get("/json/stations/search", {
        "has_geo_info": "true",
        "hidebroken": "true",
        "order": "clickcount",
        "reverse": "true",
        "limit": str(limit),
    })
    out = []
    for s in data:
        lat = s.get("geo_lat")
        lng = s.get("geo_long")
        if lat is None or lng is None:
            continue
        out.append({
            "id": s.get("stationuuid"),
            "name": s.get("name", "").strip(),
            "url": s.get("url_resolved") or s.get("url"),
            "favicon": s.get("favicon"),
            "country": s.get("country"),
            "countrycode": s.get("countrycode"),
            "state": s.get("state"),
            "tags": s.get("tags"),
            "language": s.get("language"),
            "codec": s.get("codec"),
            "bitrate": s.get("bitrate"),
            "votes": s.get("votes"),
            "clickcount": s.get("clickcount"),
            "lat": lat,
            "lng": lng,
        })
    return out


def _map_station(s: dict) -> dict:
    return {
        "id": s.get("stationuuid"),
        "name": s.get("name", "").strip(),
        "url": s.get("url_resolved") or s.get("url"),
        "favicon": s.get("favicon"),
        "country": s.get("country"),
        "countrycode": s.get("countrycode"),
        "state": s.get("state"),
        "tags": s.get("tags"),
        "language": s.get("language"),
        "codec": s.get("codec"),
        "bitrate": s.get("bitrate"),
        "votes": s.get("votes"),
        "clickcount": s.get("clickcount"),
        "lat": s.get("geo_lat"),
        "lng": s.get("geo_long"),
    }


@api_router.get("/stations/search")
async def stations_search(q: str = "", country: str = "", tag: str = "", limit: int = 60):
    params = {
        "hidebroken": "true",
        "order": "clickcount",
        "reverse": "true",
        "limit": str(limit),
    }
    if q:
        params["name"] = q
    if country:
        params["country"] = country
    if tag:
        params["tag"] = tag
    data = await rb_get("/json/stations/search", params)
    return [_map_station(s) for s in data]


@api_router.get("/stations/top")
async def stations_top(limit: int = 40):
    data = await rb_get("/json/stations/search", {
        "hidebroken": "true",
        "order": "clickcount",
        "reverse": "true",
        "limit": str(limit),
    })
    return [_map_station(s) for s in data]


@api_router.get("/countries")
async def countries():
    data = await rb_get("/json/countries", {"hidebroken": "true"})
    return [{"name": c.get("name"), "count": c.get("stationcount")}
            for c in data if c.get("name")]


@api_router.get("/station/{station_id}/nearby")
async def station_nearby(station_id: str):
    """Return the clicked station + others in the same country/city."""
    data = await rb_get(f"/json/stations/byuuid/{station_id}")
    if not data:
        raise HTTPException(status_code=404, detail="Station not found")
    base = data[0]
    country = base.get("country", "")
    nearby = await rb_get("/json/stations/search", {
        "country": country,
        "hidebroken": "true",
        "order": "clickcount",
        "reverse": "true",
        "limit": "40",
    })
    return {
        "station": _map_station(base),
        "nearby": [_map_station(s) for s in nearby if s.get("stationuuid") != station_id],
    }


@api_router.post("/station/{station_id}/click")
async def station_click(station_id: str):
    try:
        await rb_get(f"/json/url/{station_id}")
    except Exception:
        pass
    return {"ok": True}


@api_router.get("/station/{station_id}/city")
async def station_city(station_id: str):
    """Stations clustered near the clicked station (same city / region)."""
    data = await rb_get(f"/json/stations/byuuid/{station_id}")
    if not data:
        raise HTTPException(status_code=404, detail="Station not found")
    base = data[0]
    lat = base.get("geo_lat")
    lng = base.get("geo_long")
    country = base.get("country", "")
    pool = await rb_get("/json/stations/search", {
        "country": country,
        "has_geo_info": "true",
        "hidebroken": "true",
        "order": "clickcount",
        "reverse": "true",
        "limit": "500",
    })
    results = []
    if lat is not None and lng is not None:
        for s in pool:
            slat, slng = s.get("geo_lat"), s.get("geo_long")
            if slat is None or slng is None:
                continue
            d = haversine_km(lat, lng, slat, slng)
            if d <= 120:
                m = _map_station(s)
                m["distance"] = round(d, 1)
                results.append(m)
        results.sort(key=lambda x: x.get("distance", 9999))
    if len(results) < 2:
        state = base.get("state")
        if state:
            results = [_map_station(s) for s in pool if s.get("state") == state]
        if len(results) < 1:
            results = [_map_station(base)]
    city_name = (base.get("state") or "").strip() or base.get("name")
    return {
        "city": city_name,
        "country": country,
        "station": _map_station(base),
        "stations": results[:60],
    }


@api_router.get("/station/{station_id}")
async def station_one(station_id: str):
    data = await rb_get(f"/json/stations/byuuid/{station_id}")
    if not data:
        raise HTTPException(status_code=404, detail="Station not found")
    return _map_station(data[0])


@api_router.get("/nowplaying")
async def nowplaying(url: str):
    """Read ICY (Shoutcast/Icecast) metadata to find the current song title."""
    target = urllib.parse.unquote(url)
    if not target.startswith(("http://", "https://")):
        return {"title": None, "name": None}
    headers = {"Icy-MetaData": "1", "User-Agent": "Mozilla/5.0 RadioMelody"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0),
                                     follow_redirects=True,
                                     headers=headers) as c:
            async with c.stream("GET", target) as resp:
                name = resp.headers.get("icy-name")
                metaint = resp.headers.get("icy-metaint")
                if not metaint:
                    return {"title": None, "name": name}
                metaint = int(metaint)
                buf = b""
                hard_limit = metaint + 1 + 4096 + 32
                async for chunk in resp.aiter_raw():
                    buf += chunk
                    if len(buf) >= metaint + 1:
                        length = buf[metaint] * 16
                        if length == 0:
                            return {"title": None, "name": name}
                        if len(buf) >= metaint + 1 + length:
                            meta = buf[metaint + 1: metaint + 1 + length]
                            text = meta.decode("utf-8", errors="ignore")
                            m = re.search(r"StreamTitle='(.*?)';", text)
                            title = m.group(1).strip() if m else None
                            return {"title": title or None, "name": name}
                    if len(buf) > hard_limit:
                        return {"title": None, "name": name}
                return {"title": None, "name": name}
    except Exception:
        return {"title": None, "name": None}


@api_router.get("/img")
async def img(url: str):
    """Proxy a station favicon with permissive CORS so the client can sample its color."""
    target = urllib.parse.unquote(url)
    if not target.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid url")
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True,
                                     headers={"User-Agent": "Mozilla/5.0 RadioMelody"}) as c:
            r = await c.get(target)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cannot fetch image: {e}")
    if r.status_code >= 400:
        raise HTTPException(status_code=404, detail="Image not found")
    ct = r.headers.get("content-type", "image/png")
    return Response(content=r.content, media_type=ct,
                    headers={"Access-Control-Allow-Origin": "*",
                             "Cache-Control": "public, max-age=86400"})


@api_router.get("/stream")
async def stream(url: str):
    """Proxy a radio audio stream so http/mixed-content streams play over https."""
    target = urllib.parse.unquote(url)
    if not target.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid url")

    client_http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None),
                                    follow_redirects=True,
                                    headers={"User-Agent": "Mozilla/5.0 RadioMelody",
                                             "Icy-MetaData": "0"})
    try:
        req = client_http.build_request("GET", target)
        resp = await client_http.send(req, stream=True)
    except Exception as e:
        await client_http.aclose()
        raise HTTPException(status_code=502, detail=f"Cannot reach stream: {e}")

    if resp.status_code >= 400:
        await resp.aclose()
        await client_http.aclose()
        raise HTTPException(status_code=502, detail=f"Stream error {resp.status_code}")

    content_type = resp.headers.get("content-type", "audio/mpeg")

    async def iterator():
        try:
            async for chunk in resp.aiter_bytes(chunk_size=16384):
                yield chunk
        finally:
            await resp.aclose()
            await client_http.aclose()

    return StreamingResponse(iterator(), media_type=content_type,
                             headers={"Cache-Control": "no-cache",
                                      "Access-Control-Allow-Origin": "*"})


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(**input.dict())
    await db.status_checks.insert_one(status_obj.dict())
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**s) for s in status_checks]


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
