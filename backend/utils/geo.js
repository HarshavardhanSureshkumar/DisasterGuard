/**
 * Haversine distance calculation utility
 * Calculates the great-circle distance between two points on the Earth's surface
 */

const EARTH_RADIUS_KM = 6371.0;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180.0;
}

/**
 * Calculates distance in kilometers between two lat/lng coordinates
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in kilometers, rounded to 2 decimal places
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const numLat1 = Number(lat1);
  const numLon1 = Number(lon1);
  const numLat2 = Number(lat2);
  const numLon2 = Number(lon2);

  if (
    isNaN(numLat1) || isNaN(numLon1) ||
    isNaN(numLat2) || isNaN(numLon2)
  ) {
    throw new Error('Invalid coordinates provided to Haversine calculation.');
  }

  const dLat = toRadians(numLat2 - numLat1);
  const dLon = toRadians(numLon2 - numLon1);

  const radLat1 = toRadians(numLat1);
  const radLat2 = toRadians(numLat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(radLat1) * Math.cos(radLat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = EARTH_RADIUS_KM * c;
  return Math.round(distance * 100) / 100;
}

module.exports = {
  calculateHaversineDistance
};
