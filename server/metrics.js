export const ALGORITHM = "lolouk44/xiaomi_mi_scale@e9db989d21b23602a462338a285478658cbaa137";

export function ageOn(birthdate, date) {
  const [year, month, day] = birthdate.split("-").map(Number);
  const d = new Date(date);
  return d.getFullYear() - year - (d.getMonth() + 1 < month || (d.getMonth() + 1 === month && d.getDate() < day) ? 1 : 0);
}

export function validateProfile(input) {
  if (!input || typeof input !== "object") throw new Error("Perfil inválido.");
  const height = Number(input.height_cm);
  const birthdate = String(input.birthdate || "");
  const sex = String(input.sex || "");
  const parsed = new Date(`${birthdate}T12:00:00Z`);
  const age = Number.isNaN(parsed.getTime()) ? -1 : ageOn(birthdate, new Date());
  if (!Number.isFinite(height) || height < 100 || height > 220) throw new Error("La altura debe estar entre 100 y 220 cm.");
  if (age < 18 || age > 99) throw new Error("Se requiere una edad entre 18 y 99 años.");
  if (!["male", "female"].includes(sex)) throw new Error("Sexo no válido.");
  return { height_cm: height, birthdate, sex };
}

export function calculateMetrics(weight, height, age, sex, impedance) {
  if (!(weight >= 10 && weight <= 200 && height > 0 && height <= 220 && age >= 18 && age <= 99 && impedance > 0 && impedance < 3000)) {
    throw new Error("Datos fuera del intervalo admitido por el algoritmo.");
  }
  const lbm = (height * 9.058 / 100) * (height / 100) + weight * 0.32 + 12.226 - impedance * 0.0068 - age * 0.0542;
  const constFat = sex === "female" ? (age <= 49 ? 9.25 : 7.25) : 0.8;
  let coefficient = 1;
  if (sex === "male" && weight < 61) coefficient = 0.98;
  else if (sex === "female" && weight > 60) { coefficient = 0.96; if (height > 160) coefficient *= 1.03; }
  else if (sex === "female" && weight < 50) { coefficient = 1.02; if (height > 160) coefficient *= 1.03; }
  let fat = (1 - ((lbm - constFat) * coefficient / weight)) * 100;
  if (fat > 63) fat = 75;
  fat = Math.max(5, Math.min(75, fat));
  let water = (100 - fat) * 0.7;
  water *= water <= 50 ? 1.02 : 0.98;
  if (water >= 65) water = 75;
  water = Math.max(35, Math.min(75, water));
  let bone = ((sex === "female" ? 0.245691014 : 0.18016894) - lbm * 0.05158) * -1;
  bone += bone > 2.2 ? 0.1 : -0.1;
  bone = Math.max(0.5, Math.min(8, bone));
  let muscle = weight - fat / 100 * weight - bone;
  muscle = Math.max(10, Math.min(120, muscle));
  let visceral;
  if (sex === "female") {
    if (weight > (13 - height * 0.5) * -1) {
      const subsub = height * 1.45 + height * 0.1158 * height - 120;
      visceral = weight * 500 / subsub - 6 + age * 0.07;
    } else {
      const sub = 0.691 + height * -0.0024 + height * -0.0024;
      visceral = (height * 0.027 - sub * weight) * -1 + age * 0.07 - age;
    }
  } else if (height < weight * 1.6) {
    const sub = (height * 0.4 - height * (height * 0.0826)) * -1;
    visceral = weight * 305 / (sub + 48) - 2.9 + age * 0.15;
  } else {
    const sub = 0.765 + height * -0.0015;
    visceral = (height * 0.143 - weight * sub) * -1 + age * 0.15 - 5;
  }
  visceral = Math.max(1, Math.min(50, visceral));
  let bmr = sex === "female" ? 864.6 + weight * 10.2036 - height * 0.39336 - age * 6.204 : 877.8 + weight * 14.916 - height * 0.726 - age * 8.976;
  if ((sex === "female" && bmr > 2996) || (sex === "male" && bmr > 2322)) bmr = 5000;
  bmr = Math.max(500, Math.min(10000, bmr));
  const metabolicAge = Math.max(15, Math.min(80, sex === "female"
    ? height * -1.1165 + weight * 1.5784 + age * 0.4615 + impedance * 0.0415 + 83.2548
    : height * -0.7471 + weight * 0.9161 + age * 0.4184 + impedance * 0.0517 + 54.2267));
  const fatScale = sex === "male" ? [11, 17, 22, 27] : [21, 28, 35, 40];
  const muscleScale = height >= 170 ? (sex === "male" ? [49.4, 59.5] : [36.5, 42.6]) : height >= 160 ? (sex === "male" ? [44, 52.5] : [32.9, 37.6]) : (sex === "male" ? [38.5, 46.6] : [29.1, 34.8]);
  const fatFactor = fat > fatScale[2] ? 0 : fat < fatScale[1] ? 2 : 1;
  const bodyType = muscle > muscleScale[1] ? 2 + fatFactor * 3 : muscle < muscleScale[0] ? fatFactor * 3 : 1 + fatFactor * 3;
  const round = (value, digits = 6) => Number(value.toFixed(digits));
  return {
    bmi: round(weight / (height / 100) ** 2), body_fat_percent: round(fat), fat_mass_kg: round(weight * fat / 100),
    fat_free_mass_kg: round(weight * (1 - fat / 100)), muscle_mass_kg: round(muscle), water_percent: round(water),
    water_mass_kg: round(weight * water / 100), bone_mass_kg: round(bone), protein_percent: round(Math.max(5, Math.min(32, muscle / weight * 100 - water))),
    visceral_fat_index: round(visceral), basal_metabolic_rate_kcal_day: round(bmr), metabolic_age_index_years: round(metabolicAge), body_type_code: bodyType,
  };
}
