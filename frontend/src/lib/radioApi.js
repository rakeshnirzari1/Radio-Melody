import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API, timeout: 30000 });

export const getGeoStations = async (limit = 6000) => {
  const { data } = await client.get(`/stations/geo`, { params: { limit } });
  return data;
};

export const searchStations = async ({ q = "", country = "", tag = "", limit = 60 }) => {
  const { data } = await client.get(`/stations/search`, {
    params: { q, country, tag, limit },
  });
  return data;
};

export const getTopStations = async (limit = 40) => {
  const { data } = await client.get(`/stations/top`, { params: { limit } });
  return data;
};

export const getNearby = async (stationId) => {
  const { data } = await client.get(`/station/${stationId}/nearby`);
  return data;
};

export const getCity = async (stationId) => {
  const { data } = await client.get(`/station/${stationId}/city`);
  return data;
};

export const getStation = async (stationId) => {
  const { data } = await client.get(`/station/${stationId}`);
  return data;
};

export const getNowPlaying = async (url) => {
  const { data } = await client.get(`/nowplaying`, { params: { url } });
  return data;
};

export const registerClick = async (stationId) => {
  try {
    await client.post(`/station/${stationId}/click`);
  } catch (e) {
    /* silent */
  }
};

// Proxy stream URL through backend to bypass mixed-content / CORS
export const streamUrl = (url) =>
  `${API}/stream?url=${encodeURIComponent(url)}`;

// Proxy favicon through backend (adds CORS) so we can sample its color
export const imgProxyUrl = (url) =>
  url ? `${API}/img?url=${encodeURIComponent(url)}` : "";
