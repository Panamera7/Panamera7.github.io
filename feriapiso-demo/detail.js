import { inventory } from "./data.js";
import { renderDetailMap } from "./map.js";

const id = new URLSearchParams(location.search).get("id") || "palmer-1";
const x = inventory.find((i) => i.id === id);
const root = document.querySelector("#detail");

if (!x) {
  root.innerHTML =
    '<section class="section"><h1>Alojamiento no encontrado</h1><a href="./index.html">Volver</a></section>';
} else {
  document.title = `${x.name} · feriapiso demo`;
  root.innerHTML = `
  <section class="detail-hero">
    <div class="detail-gallery">
      ${x.gallery.map((src) => `<img src="${src}" alt="${x.name}">`).join("")}
    </div>
    <div>
      <p class="eyebrow">FERIAPISO APARTMENTS PALMER</p>
      <h1>${x.name}</h1>
      <p class="lead">${x.destination}</p>
      <p class="facts">${x.bedrooms} dormitorio${x.bedrooms === 1 ? "" : "s"} · ${x.bathrooms} baño${x.bathrooms === 1 ? "" : "s"} · hasta ${x.capacity} huéspedes · ${x.floor}${x.area !== "—" ? " · " + x.area : ""}</p>
      <p>${x.description}</p>
      ${x.license !== "—" ? `<p class="meta">Licencia ${x.license}</p>` : ""}
      <div class="booking-box">
        <strong>${x.night} € / noche</strong>
        <p>Demo read-only: precios orientativos. La reserva real va por Smoobu cuando feriapiso.com vuelva.</p>
        <a class="detail-button" href="https://booking.smoobu.com/palmer" target="_blank" rel="noopener">Abrir motor Smoobu</a>
        <a class="detail-button secondary" href="./index.html#alojamientos">Volver a resultados</a>
      </div>
    </div>
  </section>
  <section class="section">
    <h2>Mapa</h2>
    <div id="detailMap" class="detail-map"></div>
    <p class="caption">Amadeu Vives 42, L'Hospitalet de Llobregat · OpenStreetMap</p>
  </section>`;
  renderDetailMap(document.querySelector("#detailMap"), x);
}
