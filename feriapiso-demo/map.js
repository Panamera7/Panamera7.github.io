import { BUILDING, inventory } from "./data.js";

let map;

export function renderLeafletMap(root, items = inventory) {
  if (!root) return;
  root.innerHTML = '<div id="leafletMap" class="leaflet-host"></div>';
  const el = root.querySelector("#leafletMap");
  if (map) {
    map.remove();
    map = null;
  }
  map = L.map(el, { scrollWheelZoom: false }).setView([BUILDING.lat, BUILDING.lng], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const bounds = [];
  items.forEach((x) => {
    const m = L.marker([x.lat, x.lng]).addTo(map);
    m.bindPopup(
      `<strong>${x.name}</strong><br>${x.capacity} huéspedes<br><a href="./alojamiento.html?id=${x.id}">Ver ficha</a>`
    );
    bounds.push([x.lat, x.lng]);
  });
  if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  setTimeout(() => map.invalidateSize(), 80);
  return map;
}

export function renderDetailMap(root, item) {
  if (!root || !item) return;
  root.innerHTML = '<div id="detailLeaflet" class="leaflet-host detail-leaflet"></div>';
  const el = root.querySelector("#detailLeaflet");
  const m = L.map(el, { scrollWheelZoom: false }).setView([item.lat, item.lng], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(m);
  L.marker([item.lat, item.lng]).addTo(m).bindPopup(item.name).openPopup();
  setTimeout(() => m.invalidateSize(), 80);
}
