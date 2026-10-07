/** Demo inventory — Palmer units (photos in photos-*.js). */
import { cover as c1, gallery as g1 } from "./photos-p1.js";
import { cover as c2, gallery as g2 } from "./photos-p2.js";
import { cover as c3, gallery as g3 } from "./photos-p3.js";
export { MAP_IMAGE } from "./map-image.js";

export const BUILDING = {
  address: "Amadeu Vives 42, L'Hospitalet de Llobregat",
  lat: 41.37378,
  lng: 2.10416,
};

export const inventory = [
  {
    id: "palmer-1",
    name: "Palmer I",
    capacity: 2,
    bedrooms: 1,
    bathrooms: 1,
    area: "50 m²",
    floor: "Planta baja",
    license: "ATB-000163",
    night: 95,
    provider: "Palmer",
    destination: "L’Hospitalet de Llobregat · Barcelona",
    lat: 41.37378,
    lng: 2.10416,
    cover: c1,
    gallery: g1,
    description:
      "1 cama doble y 1 sofá cama doble. Acceso directo desde la calle. Salón/comedor con cocina integrada, patio interior, licencia ATB-000163.",
  },
  {
    id: "palmer-2",
    name: "Palmer II",
    capacity: 3,
    bedrooms: 2,
    bathrooms: 1,
    area: "—",
    floor: "1ª planta · sin ascensor",
    license: "—",
    night: 110,
    provider: "Palmer",
    destination: "L’Hospitalet de Llobregat · Barcelona",
    lat: 41.37385,
    lng: 2.10425,
    cover: c2,
    gallery: g2,
    description:
      "En la 1ª planta de un edificio sin ascensor. Hasta 3 personas, ambiente acogedor junto a Barcelona.",
  },
  {
    id: "palmer-3",
    name: "Palmer III",
    capacity: 5,
    bedrooms: 3,
    bathrooms: 3,
    area: "123 m²",
    floor: "2ª planta · sin ascensor",
    license: "—",
    night: 145,
    provider: "Palmer",
    destination: "L’Hospitalet de Llobregat · Barcelona",
    lat: 41.3737,
    lng: 2.10405,
    cover: c3,
    gallery: g3,
    description:
      "123 m², 3 baños, hasta 5 personas. 2ª planta sin ascensor. Ideal para grupos o familias.",
  },
];
