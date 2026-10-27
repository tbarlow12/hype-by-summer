export const EXERCISE_CATEGORIES = ["strength", "cardio", "mobility", "plyometric", "core"] as const;

export const MUSCLES = [
  "quads", "hamstrings", "glutes", "calves", "adductors", "chest", "back", "lats", "upper_back",
  "shoulders", "rear_delts", "biceps", "triceps", "forearms", "core", "obliques", "hip_flexors", "full_body",
] as const;

export const EQUIPMENT = [
  "bodyweight", "barbell", "dumbbell", "kettlebell", "cable", "machine", "band", "bench", "rack",
  "pullup_bar", "trx", "medicine_ball", "box", "sled", "bike", "rower", "treadmill", "foam_roller",
] as const;

export const PROGRAM_STATUSES = ["draft", "active", "completed", "archived"] as const;

export const DAY_NAMES = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];

/** 1-5 rating labels for check-ins (higher = better, except stress). */
export const RATING_HINTS = {
  sleep_quality: ["Terrible", "Poor", "OK", "Good", "Great"],
  stress_level: ["Very low", "Low", "Moderate", "High", "Very high"],
  energy_level: ["Drained", "Low", "OK", "Good", "Great"],
  nutrition_adherence: ["Off track", "Rough", "Mixed", "Mostly on", "Nailed it"],
  training_adherence: ["Missed it all", "Missed most", "About half", "Most", "Every session"],
} as const;
