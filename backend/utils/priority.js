/**
 * Deterministic Server-Side SOS Priority Calculation
 * Evaluates emergency type, medical requirement, and vulnerable headcount.
 */

const EMERGENCY_TYPE_WEIGHTS = {
  'medical emergency': 35,
  'medical': 35,
  'flood': 30,
  'flash flood': 30,
  'fire': 30,
  'landslide': 30,
  'structural collapse': 30,
  'building damage': 30,
  'earthquake': 30,
  'cyclone': 25,
  'road blockage': 15,
  'other': 10
};

/**
 * Calculates priority score and returns canonical level
 * @param {Object} params
 * @param {string} params.emergencyType
 * @param {boolean|string} params.medical
 * @param {number} params.peopleCount
 * @returns {'CRITICAL'|'HIGH'|'MODERATE'|'LOW'}
 */
function calculateSOSPriority({ emergencyType, medical, peopleCount }) {
  let score = 0;

  // 1. Emergency Type Weight
  const normalizedType = String(emergencyType || 'other').trim().toLowerCase();
  const typeWeight = EMERGENCY_TYPE_WEIGHTS[normalizedType] ?? 10;
  score += typeWeight;

  // 2. Medical Requirement (+35)
  const isMedical = medical === true || String(medical).toLowerCase() === 'yes';
  if (isMedical) {
    score += 35;
  }

  // 3. Vulnerable Headcount Weight
  const people = parseInt(peopleCount, 10) || 1;
  if (people >= 5) {
    score += 25;
  } else if (people >= 3) {
    score += 15;
  } else if (people >= 1) {
    score += 5;
  }

  // 4. Threshold Evaluation
  if (score >= 65) {
    return 'CRITICAL';
  } else if (score >= 45) {
    return 'HIGH';
  } else if (score >= 25) {
    return 'MODERATE';
  }
  return 'LOW';
}

module.exports = {
  calculateSOSPriority
};
