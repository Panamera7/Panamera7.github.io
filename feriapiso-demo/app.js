import { inventory } from "./data.js";
import { renderLeafletMap } from "./map.js";

const results = document.querySelector("#results");
const count = document.querySelector("#resultCount");
const split = document.querySelector(".split");

function nights() {
  const a = document.querySelector("#checkin").value;
  const b = document.querySelector("#checkout").value;
  if (!a || !b) return 1;
  const d = Math.round((new Date(b) - new Date(a)) / 86400000);
  return d > 0 ? d : 1;
}

function render(items) {
  const n = nights();
  if (count) count.textContent = `${items.length} alojamientos · ${n} noche${n === 1 ? "" : "s"}`;
  results.innerHTML = items.length
    ? items
        .map(
          (x) => `<article class="row">
    <div class="photo"><img src="${x.cover}" alt="${x.name}"></div>
    <div class="card-body">
      <p class="eyebrow">${x.provider} · inventario propio</p>
      <h3>${x.name}</h3>
      <p class="meta">${x.destination}</p>
      <p>${x.bedrooms} dormitorio${x.bedrooms === 1 ? "" : "s"} · hasta ${x.capacity} huéspedes · ${x.floor}</p>
      <a class="card-link" href="./alojamiento.html?id=${encodeURIComponent(x.id)}">Ver alojamiento</a>
    </div>
    <div class="price">
      <strong>${x.night} €</strong>
      <span>por noche (demo)</span>
      <em>${x.night * n} € estancia</em>
    </div>
  </article>`
        )
        .join("")
    : "<p>No hay alojamientos que coincidan con esta búsqueda.</p>";
  renderLeafletMap(document.querySelector("#mapResults"), items);
}

function apply() {
  const guests = Number(document.querySelector("#guests").value);
  const destination = document.querySelector("#destination").value.trim().toLowerCase();
  const onlyPalmer = document.querySelector("#onlyPalmer");
  const filtered = inventory.filter((x) => {
    if (x.capacity < guests) return false;
    if (onlyPalmer && onlyPalmer.checked && x.provider !== "Palmer") return false;
    if (!destination) return true;
    const hay = (x.destination + " " + x.name).toLowerCase();
    return (
      hay.includes(destination) ||
      destination.includes("barcelona") ||
      destination.includes("hospitalet") ||
      destination.includes("palmer")
    );
  });
  render(filtered);
}

render(inventory);
document.querySelector("#search").addEventListener("submit", (e) => {
  e.preventDefault();
  apply();
});
document.querySelector("#onlyPalmer")?.addEventListener("change", apply);

const listBtn = document.querySelector("#listView");
const mapBtn = document.querySelector("#mapView");
const splitBtn = document.querySelector("#splitView");
function mode(name) {
  split.classList.remove("list-only", "map-only");
  if (name === "list") split.classList.add("list-only");
  if (name === "map") split.classList.add("map-only");
  [listBtn, mapBtn, splitBtn].forEach((b) => b && b.classList.remove("active"));
  if (name === "list") listBtn.classList.add("active");
  else if (name === "map") mapBtn.classList.add("active");
  else splitBtn.classList.add("active");
  setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
}
listBtn.addEventListener("click", () => mode("list"));
mapBtn.addEventListener("click", () => mode("map"));
splitBtn?.addEventListener("click", () => mode("split"));
