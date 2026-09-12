const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

// Punto aleatorio dentro de un radio (km) alrededor de un centro, con
// distribución uniforme por área (no por ángulo/radio directo, que
// concentraría puntos cerca del centro). `random` es un SimulationRandomService
// para que la generación sea reproducible por seed.
function randomPointInRadius(random, center, radiusKm) {
  const angle = random.nextFloat(0, 2 * Math.PI);
  const distanceKm = Math.sqrt(random.next()) * radiusKm;

  const deltaLat = (distanceKm / 111) * Math.cos(angle);
  const deltaLng =
    (distanceKm / (111 * Math.cos(toRadians(center.lat)))) * Math.sin(angle);

  return {
    lat: center.lat + deltaLat,
    lng: center.lng + deltaLng,
  };
}

module.exports = {
  haversineDistanceKm,
  randomPointInRadius,
};
