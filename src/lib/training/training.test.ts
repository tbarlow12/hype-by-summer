import { describe, expect, it } from "vitest";
import { adherenceByWeek, adherenceToDate, feedbackFlags, overallAdherence } from "./adherence";
import { addDays, programPosition, programWorkoutDate, todayInTz, weekStartMonday } from "./dates";
import { bestStreak, countInWeek, currentStreak, goalProgress } from "./habits";
import { buildPrefill, parseDurationTarget, parseLoad, parseRepTarget } from "./prefill";
import { computePersonalRecords, epley1RM, recentPRs, type LoggedSet } from "./records";
import { parseVideoUrl } from "./video";
import { exerciseUsableBy, inboxScope, responsibleCoachIds, type StaffMember } from "./routing";

describe("epley1RM", () => {
  it("estimates a one-rep max", () => {
    expect(epley1RM(100, 10)).toBe(133.3);
    expect(epley1RM(225, 5)).toBe(262.5);
  });
  it("returns the weight for a single", () => {
    expect(epley1RM(315, 1)).toBe(315);
  });
  it("ignores empty sets", () => {
    expect(epley1RM(0, 5)).toBe(0);
    expect(epley1RM(100, 0)).toBe(0);
  });
});

describe("computePersonalRecords", () => {
  const base = { exercise_id: "sq", exercise_name: "Back Squat", weight_unit: "lb", completed: true };
  const sets: LoggedSet[] = [
    { ...base, reps: 5, weight: 225, performed_on: "2030-01-01" },
    { ...base, reps: 1, weight: 255, performed_on: "2030-01-08" },
    { ...base, reps: 8, weight: 225, performed_on: "2030-01-15" },
    { ...base, reps: 20, weight: 300, completed: false, performed_on: "2030-01-16" },
    { exercise_id: "bp", exercise_name: "Bench Press", reps: 5, weight: 100, weight_unit: "kg", completed: true, performed_on: "2030-01-02" },
    { exercise_id: "bp", exercise_name: "Bench Press", reps: 5, weight: 200, weight_unit: "lb", completed: true, performed_on: "2030-01-09" },
  ];
  const prs = computePersonalRecords(sets);

  it("tracks heaviest set and best estimated 1RM separately", () => {
    const squat = prs.find((p) => p.exercise_id === "sq")!;
    expect(squat.heaviest).toMatchObject({ weight: 255, reps: 1, performed_on: "2030-01-08" });
    expect(squat.best1RM).toMatchObject({ weight: 225, reps: 8, estimate: 285 });
    expect(squat.mostReps).toBe(8);
  });
  it("skips incomplete sets", () => {
    expect(prs.find((p) => p.exercise_id === "sq")!.heaviest.weight).not.toBe(300);
  });
  it("compares kg and lb fairly", () => {
    const bench = prs.find((p) => p.exercise_id === "bp")!;
    expect(bench.heaviest).toMatchObject({ weight: 100, unit: "kg" });
  });
  it("sorts by name and lists recent PRs first", () => {
    expect(prs.map((p) => p.exercise_name)).toEqual(["Back Squat", "Bench Press"]);
    expect(recentPRs(prs)[0]!.exercise_id).toBe("sq");
  });
});

describe("dates", () => {
  it("finds the Monday of a week", () => {
    expect(weekStartMonday("2026-10-27")).toBe("2026-10-26"); // Tue -> Mon
    expect(weekStartMonday("2026-11-01")).toBe("2026-10-26"); // Sun -> Mon
    expect(weekStartMonday("2026-10-26")).toBe("2026-10-26");
  });
  it("dates program days from the start date", () => {
    expect(programWorkoutDate("2030-01-07", 1, 1)).toBe("2030-01-07");
    expect(programWorkoutDate("2030-01-07", 2, 3)).toBe("2030-01-16");
    expect(addDays("2030-02-28", 1)).toBe("2030-03-01");
  });
  it("locates today inside a program", () => {
    expect(programPosition("2030-01-07", 4, "2030-01-06")).toBeNull();
    expect(programPosition("2030-01-07", 4, "2030-01-07")).toEqual({ week: 1, day: 1 });
    expect(programPosition("2030-01-07", 4, "2030-01-20")).toEqual({ week: 2, day: 7 });
    expect(programPosition("2030-01-07", 4, "2030-02-04")).toBeNull();
  });
  it("uses the timezone for today", () => {
    const now = new Date("2030-01-07T03:00:00Z");
    expect(todayInTz("America/Denver", now)).toBe("2030-01-06");
    expect(todayInTz("Europe/London", now)).toBe("2030-01-07");
  });
});

describe("adherence", () => {
  const workouts = [
    { id: "a", week: 1 }, { id: "b", week: 1 }, { id: "c", week: 2 }, { id: "d", week: 2 }, { id: "e", week: 3 },
  ];
  const weeks = adherenceByWeek(workouts, ["a", "a", "c", "d", null], 4);
  it("counts each prescribed workout once per week", () => {
    expect(weeks.map((w) => w.pct)).toEqual([50, 100, 0, null]);
  });
  it("computes overall adherence through a week", () => {
    expect(overallAdherence(weeks, 2)).toBe(75);
    expect(overallAdherence(weeks, 3)).toBe(60);
    expect(overallAdherence([], 1)).toBeNull();
  });
  it("flags pain and difficulty trends", () => {
    const flags = feedbackFlags([
      { difficulty_rating: 5, pain_flag: true },
      { difficulty_rating: null, pain_flag: false },
      { difficulty_rating: 4, pain_flag: false },
      { difficulty_rating: 1, pain_flag: false },
    ]);
    expect(flags.map((f) => f.kind)).toEqual(["pain", "too_hard"]);
    expect(feedbackFlags([{ difficulty_rating: 2, pain_flag: false }, { difficulty_rating: 1, pain_flag: false }]).map((f) => f.kind)).toEqual(["too_easy"]);
    expect(feedbackFlags([{ difficulty_rating: 3, pain_flag: false }])).toEqual([]);
  });
});

describe("habits", () => {
  const logged = ["2030-01-01", "2030-01-02", "2030-01-03", "2030-01-05", "2030-01-06"];
  it("counts the current streak (today or through yesterday)", () => {
    expect(currentStreak(logged, "2030-01-06")).toBe(2);
    expect(currentStreak(logged, "2030-01-07")).toBe(2);
    expect(currentStreak(logged, "2030-01-08")).toBe(0);
  });
  it("finds the best streak", () => {
    expect(bestStreak(logged)).toBe(3);
    expect(bestStreak([])).toBe(0);
  });
  it("counts days in a week", () => {
    expect(countInWeek(logged, "2029-12-31")).toBe(5);
    expect(countInWeek(logged, "2030-01-07")).toBe(0);
  });
  it("computes goal progress in both directions", () => {
    expect(goalProgress({ current_value: 50, target_value: 100 })).toBe(50);
    expect(goalProgress({ start_value: 200, current_value: 190, target_value: 180 })).toBe(50);
    expect(goalProgress({ start_value: 200, current_value: 210, target_value: 180 })).toBe(0);
    expect(goalProgress({ current_value: null, target_value: 10 })).toBeNull();
  });
});

describe("prefill", () => {
  it("parses rep and duration targets", () => {
    expect(parseRepTarget("8-10")).toBe(8);
    expect(parseRepTarget("AMRAP")).toBeNull();
    expect(parseRepTarget("30s")).toBeNull();
    expect(parseDurationTarget("30s")).toBe(30);
    expect(parseDurationTarget("1 min")).toBe(60);
  });
  it("parses loads", () => {
    expect(parseLoad("135 lb")).toEqual({ weight: 135, unit: "lb", rpe: null });
    expect(parseLoad("60kg")).toEqual({ weight: 60, unit: "kg", rpe: null });
    expect(parseLoad("RPE 8")).toEqual({ weight: null, unit: null, rpe: 8 });
    expect(parseLoad("70% 1RM")).toEqual({ weight: null, unit: null, rpe: null });
  });
  it("prefers the last performance, then the prescription", () => {
    const fromPrescription = buildPrefill({ sets: 3, reps: "8-10", load: "95 lb" }, []);
    expect(fromPrescription).toHaveLength(3);
    expect(fromPrescription[2]).toMatchObject({ set_number: 3, reps: 8, weight: 95, weight_unit: "lb" });

    const fromLast = buildPrefill({ sets: 3, reps: "8", load: null }, [
      { set_number: 1, reps: 8, weight: 100, weight_unit: "kg" },
      { set_number: 2, reps: 7, weight: 105, weight_unit: "kg" },
    ]);
    expect(fromLast.map((s) => s.weight)).toEqual([100, 105, 105]);
    expect(fromLast[0]!.weight_unit).toBe("kg");
  });
});

describe("parseVideoUrl", () => {
  it("handles YouTube variants", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?t=3",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://m.youtube.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(parseVideoUrl(url)).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    }
  });
  it("handles Vimeo and files", () => {
    expect(parseVideoUrl("https://vimeo.com/76979871")).toMatchObject({ kind: "vimeo", id: "76979871" });
    expect(parseVideoUrl("https://player.vimeo.com/video/76979871")).toMatchObject({ kind: "vimeo" });
    expect(parseVideoUrl("https://cdn.example.com/squat.mp4")).toEqual({ kind: "file", src: "https://cdn.example.com/squat.mp4" });
  });
  it("rejects anything else", () => {
    expect(parseVideoUrl("javascript:alert(1)")).toBeNull();
    expect(parseVideoUrl("https://example.com/page")).toBeNull();
    expect(parseVideoUrl("not a url")).toBeNull();
    expect(parseVideoUrl("")).toBeNull();
  });
});

describe("adherenceToDate", () => {
  const ws = [
    { id: "a", week: 1, day: 1 },
    { id: "b", week: 1, day: 3 },
    { id: "c", week: 1, day: 5 },
    { id: "d", week: 2, day: 1 },
  ];
  it("only counts workouts due so far", () => {
    expect(adherenceToDate(ws, ["a"], { week: 1, day: 1 })).toBe(100);
    expect(adherenceToDate(ws, [], { week: 1, day: 3 })).toBe(0);
    expect(adherenceToDate(ws, ["a"], { week: 1, day: 4 })).toBe(50);
  });
  it("counts workouts done early", () => {
    expect(adherenceToDate(ws, ["a", "b"], { week: 1, day: 1 })).toBe(100);
  });
  it("is null before anything is due", () => {
    expect(adherenceToDate([{ id: "x", week: 1, day: 2 }], [], { week: 1, day: 1 })).toBeNull();
  });
});

describe("responsibleCoachIds", () => {
  const members: StaffMember[] = [
    { user_id: "owner", role: "owner", active: true },
    { user_id: "admin", role: "admin", active: true },
    { user_id: "coach-a", role: "coach", active: true },
    { user_id: "coach-b", role: "coach", active: true },
    { user_id: "gone", role: "coach", active: false },
    { user_id: "old-admin", role: "admin", active: false },
  ];
  it("prefers the program's coach", () => {
    expect(responsibleCoachIds({ programCoachId: "coach-a", primaryCoachId: "coach-b", members })).toEqual(["coach-a"]);
  });
  it("falls back to the client's primary coach", () => {
    expect(responsibleCoachIds({ programCoachId: null, primaryCoachId: "coach-b", members })).toEqual(["coach-b"]);
    expect(responsibleCoachIds({ programCoachId: "gone", primaryCoachId: "coach-b", members })).toEqual(["coach-b"]);
  });
  it("falls back to active owners and admins", () => {
    expect(responsibleCoachIds({ programCoachId: "gone", primaryCoachId: "stranger", members }).sort()).toEqual(["admin", "owner"]);
    expect(responsibleCoachIds({ members }).sort()).toEqual(["admin", "owner"]);
  });
  it("never routes to someone outside the business", () => {
    expect(responsibleCoachIds({ programCoachId: "stranger", members: [] })).toEqual([]);
  });
});

describe("exerciseUsableBy", () => {
  it("allows global and own exercises only", () => {
    expect(exerciseUsableBy({ business_id: null }, "b1")).toBe(true);
    expect(exerciseUsableBy({ business_id: "b1" }, "b1")).toBe(true);
    expect(exerciseUsableBy({ business_id: "b2" }, "b1")).toBe(false);
  });
});

describe("inboxScope", () => {
  it("defaults coaches to their clients and managers to everyone", () => {
    expect(inboxScope(undefined, false)).toBe("mine");
    expect(inboxScope(undefined, true)).toBe("all");
  });
  it("honours an explicit toggle", () => {
    expect(inboxScope("all", false)).toBe("all");
    expect(inboxScope("mine", true)).toBe("mine");
    expect(inboxScope("bogus", false)).toBe("mine");
    expect(inboxScope(["all"], false)).toBe("mine");
  });
});
