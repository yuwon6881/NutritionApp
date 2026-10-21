import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import { calculateLivePace } from './web/src/lib/coachCalc';
import { liveGoalProgress } from './web/src/lib/goalProgress';
import { nextOccurrence, periodStart } from './web/src/lib/checkIn';
import { shiftDate } from './web/src/lib/energyBalance';
import { progressRange } from './web/src/lib/progress';
import type {
  AcceptedTargetInterval,
  BodyRecord,
  CheckInDecision,
  CoachPreview,
  CoachResult,
  CoachingSettings,
  Day,
  Entry,
  Food,
  FoodSearchResult,
  Mutation,
  PhaseDecision,
  PhysiquePhoto,
  Plan,
  Portion,
  Profile,
  ProgressEnergyBucket,
  ProgressPeriod,
  ProgressSummary,
  ProgressWeightPoint,
  TrajectoryPoint,
  Weight
} from './web/src/types';

const rootDir = resolve(import.meta.dirname);
const webDir = resolve(rootDir, 'web');
const distDir = resolve(webDir, 'dist');

interface UsdaFoodItem {
  result: FoodSearchResult;
  tokens: string[];
  leadLength: number;
}

let usdaDataset: UsdaFoodItem[] | null = null;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function loadUsdaDataset(): UsdaFoodItem[] {
  if (usdaDataset) return usdaDataset;
  const gzPath = resolve(rootDir, 'api/Services/Food/Data/usda-generic.json.gz');
  if (!existsSync(gzPath)) {
    usdaDataset = [];
    return usdaDataset;
  }
  try {
    const raw = gunzipSync(readFileSync(gzPath)).toString('utf8');
    const parsed = JSON.parse(raw) as {
      foods?: Array<{
        n?: string;
        k?: number;
        p?: number | null;
        f?: number | null;
        c?: number | null;
        fi?: number | null;
        s?: Array<[string, number]>;
      }>;
    };
    const items: UsdaFoodItem[] = [];
    for (const f of parsed.foods ?? []) {
      if (!f.n || typeof f.k !== 'number') continue;
      const portions: Portion[] = [];
      for (const s of f.s ?? []) {
        if (Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'number' && s[1] > 0) {
          portions.push({ label: s[0], grams: s[1] });
        }
      }
      const limited = portions.slice(0, 8);
      const firstPortion = limited[0];
      const servingCalories = firstPortion ? Math.round((f.k * firstPortion.grams) / 100) : null;
      const result: FoodSearchResult = {
        name: f.n,
        calories: f.k,
        protein: f.p ?? null,
        fat: f.f ?? null,
        carbs: f.c ?? null,
        fiber: f.fi ?? null,
        source: 'USDA FoodData Central',
        servingGrams: 100,
        servingCalories,
        portions: limited,
        code: null,
        basis: 'per100g',
        measure: 'g'
      };
      const lead = f.n.split(',')[0] ?? f.n;
      items.push({
        result,
        tokens: tokenize(f.n),
        leadLength: tokenize(lead).length
      });
    }
    usdaDataset = items;
  } catch {
    usdaDataset = [];
  }
  return usdaDataset;
}

interface UserStore {
  id: string;
  displayName: string;
  revision: number;
  profileRevision: number;
  foodRevision: number;
  diaryRevision: number;
  trajectoryRevision: number;
  bodyRevision: number;
  settings: CoachingSettings;
  profile: Profile | null;
  entries: Map<string, Entry>;
  foods: Map<string, Food>;
  weights: Map<string, Weight>;
  days: Map<string, Day>;
  plans: Plan[];
  checkIns: CheckInDecision[];
  phaseDecisions: PhaseDecision[];
  bodyRecords: Map<string, BodyRecord>;
  photoBlobs: Map<string, Buffer>;
  receipts: Map<string, { revision: number; data?: unknown }>;
  reminder: {
    enabled: boolean;
    weekday: number;
    localTime: string;
    timeZoneId: string;
    devices: Set<string>;
  };
  conversation: {
    conversationId: string;
    version: number;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      createdAt: string;
      actionBatch?: {
        batchId: string;
        status: 'pending' | 'accepted' | 'dismissed';
        actions: Array<{ type: string; label: string; description?: string; payload: Record<string, unknown> }>;
      } | null;
    }>;
  };
}

const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';
const users = new Map<string, UserStore>();
let signedOutSession = false;

function currentIsoDate(timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function createDefaultUser(id = DEFAULT_USER_ID, displayName = 'Alex Rivera'): UserStore {
  const today = currentIsoDate('America/Los_Angeles');
  const profile: Profile = {
    age: 30,
    dateOfBirth: '1996-04-15',
    heightCm: 174,
    weightKg: 74.5,
    sex: 'female',
    activity: 1.375,
    activityLevel: 'lifting',
    goal: 'lose',
    maintenance: 2150,
    proteinGrams: null,
    resistanceTraining: true,
    pregnancyOrBreastfeeding: false,
    medicalNutrition: false,
    timeZone: 'America/Los_Angeles',
    phaseMode: 'weight',
    phaseStart: shiftDate(today, -14),
    durationWeeks: null,
    targetWeightKg: 70,
    phaseStartWeightKg: 75.4,
    goalRatePercent: -0.5,
    distributionShares: null,
    energyAdjustmentPercent: null,
    proteinPercent: null,
    carbsPercent: null,
    fatPercent: null,
    macroPreset: null
  };

  const live = calculateLivePace({ ...profile, sex: profile.sex, goal: profile.goal }, undefined, profile.maintenance, today);
  const initialPlanResult: CoachResult = {
    eligible: true,
    adaptive: false,
    calories: live.target,
    expenditure: live.expenditure,
    protein: live.protein,
    fat: live.fat,
    carbs: live.carbs,
    explanation: 'Targets are set from your profile and lifting schedule.',
    version: '2.0',
    weeklyCalories: live.weeklyCalories,
    dailyCalories: live.dailyCalories,
    goalRatePercent: live.goalRatePercent,
    effectiveGoal: profile.goal,
    phaseComplete: false,
    proteinFixed: true
  };

  const plan: Plan = {
    id: '00000000-0000-4000-8000-000000000101',
    revision: 1,
    deleted: false,
    date: shiftDate(today, -14),
    inputRevision: 1,
    profileRevision: 1,
    coachingSettingsRevision: 1,
    cadenceRevision: 1,
    checkInWeekday: 1,
    resultJson: JSON.stringify(initialPlanResult)
  };

  const weights = new Map<string, Weight>();
  const sampleWeights: Array<[number, number]> = [
    [-14, 75.4],
    [-12, 75.2],
    [-10, 75.0],
    [-8, 74.9],
    [-6, 74.8],
    [-4, 74.7],
    [-2, 74.6],
    [0, 74.5]
  ];
  sampleWeights.forEach(([offset, kg], idx) => {
    const wId = `00000000-0000-4000-8000-00000000020${idx + 1}`;
    weights.set(wId, {
      id: wId,
      revision: 1,
      deleted: false,
      date: shiftDate(today, offset),
      kg,
      context: null,
      source: 'manual'
    });
  });

  const entries = new Map<string, Entry>();
  const sampleEntries: Array<Omit<Entry, 'id' | 'revision' | 'deleted'>> = [
    {
      date: today,
      time: '08:30',
      name: 'Greek yogurt, plain, nonfat',
      calories: 148,
      protein: 25.5,
      carbs: 9.0,
      fat: 1.0,
      fiber: 0,
      source: 'USDA FoodData Central',
      portionLabel: '1 container',
      portionGrams: 250,
      quantity: 1,
      unit: 'serving',
      measure: 'g'
    },
    {
      date: today,
      time: '08:30',
      name: 'Blueberries, raw',
      calories: 57,
      protein: 0.7,
      carbs: 14.5,
      fat: 0.3,
      fiber: 2.4,
      source: 'USDA FoodData Central',
      portionLabel: null,
      portionGrams: null,
      quantity: 100,
      unit: 'g',
      measure: 'g'
    },
    {
      date: today,
      time: '12:45',
      name: 'Chicken breast, grilled, skinless',
      calories: 297,
      protein: 55.8,
      carbs: 0,
      fat: 6.4,
      fiber: 0,
      source: 'USDA FoodData Central',
      portionLabel: null,
      portionGrams: null,
      quantity: 180,
      unit: 'g',
      measure: 'g'
    },
    {
      date: today,
      time: '12:45',
      name: 'Rice, white, cooked',
      calories: 260,
      protein: 5.4,
      carbs: 56.4,
      fat: 0.6,
      fiber: 0.8,
      source: 'USDA FoodData Central',
      portionLabel: null,
      portionGrams: null,
      quantity: 200,
      unit: 'g',
      measure: 'g'
    }
  ];
  sampleEntries.forEach((entry, idx) => {
    const eId = `00000000-0000-4000-8000-00000000030${idx + 1}`;
    entries.set(eId, {
      ...entry,
      id: eId,
      revision: 1,
      deleted: false
    });
  });

  return {
    id,
    displayName,
    revision: 1,
    profileRevision: 1,
    foodRevision: 1,
    diaryRevision: 1,
    trajectoryRevision: 1,
    bodyRevision: 1,
    settings: {
      checkInWeekday: 1,
      revision: 1,
      changedDate: null,
      cadenceRevision: 1,
      cadenceChangedDate: null,
      weightUnit: 'kg',
      energyUnit: 'kcal',
      heightUnit: 'cm',
      missingDayAction: 'ask',
      weightGoalMetric: 'trend'
    },
    profile,
    entries,
    foods: new Map(),
    weights,
    days: new Map(),
    plans: [plan],
    checkIns: [],
    phaseDecisions: [],
    bodyRecords: new Map(),
    photoBlobs: new Map(),
    receipts: new Map(),
    reminder: {
      enabled: false,
      weekday: 1,
      localTime: '08:00',
      timeZoneId: 'America/Los_Angeles',
      devices: new Set()
    },
    conversation: {
      conversationId: crypto.randomUUID(),
      version: 1,
      messages: []
    }
  };
}

function getUser(): UserStore {
  let u = users.get(DEFAULT_USER_ID);
  if (!u) {
    u = createDefaultUser();
    users.set(DEFAULT_USER_ID, u);
  }
  return u;
}

function buildAcceptedTargetIntervals(plans: Plan[], today: string): AcceptedTargetInterval[] {
  const active = plans
    .filter(p => !p.deleted)
    .sort((a, b) => a.date.localeCompare(b.date) || a.revision - b.revision);
  return active
    .map((plan, index) => {
      const result = JSON.parse(plan.resultJson) as CoachResult;
      const next = index + 1 < active.length ? shiftDate(active[index + 1].date, -1) : today;
      return {
        start: plan.date,
        end: next,
        calories: result.calories,
        weeklyCalories: result.weeklyCalories ?? null,
        dailyCalories: result.dailyCalories ?? null,
        protein: result.protein ?? null,
        carbs: result.carbs ?? null,
        fat: result.fat ?? null,
        proteinFixed: result.proteinFixed
      };
    })
    .filter(interval => interval.end >= interval.start);
}

function computeSmoothedWeights(weights: Weight[]): Array<{ date: string; scaleKg: number; trendKg: number }> {
  const active = weights
    .filter(w => !w.deleted)
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: Array<{ date: string; scaleKg: number; trendKg: number }> = [];
  let trend = active[0]?.kg ?? 0;
  for (let i = 0; i < active.length; i++) {
    const w = active[i];
    if (i === 0) {
      trend = w.kg;
    } else {
      trend = Math.round((trend * 0.9 + w.kg * 0.1) * 100) / 100;
    }
    out.push({ date: w.date, scaleKg: w.kg, trendKg: trend });
  }
  return out;
}

function buildEnergyEstimates(user: UserStore, start: string, end: string): TrajectoryPoint[] {
  const activePlans = user.plans.filter(p => !p.deleted).sort((a, b) => b.revision - a.revision);
  const latestPlan = activePlans[0] ? (JSON.parse(activePlans[0].resultJson) as CoachResult) : null;
  const expenditure = latestPlan?.expenditure ?? user.profile?.maintenance ?? 2150;
  const suggestedCalories = latestPlan?.calories ?? 1800;
  const smoothed = computeSmoothedWeights([...user.weights.values()]);
  const byDate = new Map(smoothed.map(s => [s.date, s.trendKg]));

  const points: TrajectoryPoint[] = [];
  let lastTrend = smoothed[0]?.trendKg ?? user.profile?.weightKg ?? null;
  let cursor = shiftDate(start, -1);
  while (cursor <= end) {
    if (byDate.has(cursor)) lastTrend = byDate.get(cursor)!;
    points.push({
      date: cursor,
      revision: user.revision,
      expenditure,
      suggestedCalories,
      confidence: 0.85,
      holdReason: null,
      algorithmVersion: '2.0',
      trendWeightKg: lastTrend
    });
    cursor = shiftDate(cursor, 1);
  }
  return points;
}

function buildBootstrapPayload(user: UserStore, includeFoods = false) {
  const today = currentIsoDate(user.profile?.timeZone);
  const start = shiftDate(today, -89);
  const detailDays = 90;
  const detailCutoff = shiftDate(today, -89);
  const entries = [...user.entries.values()]
    .filter(e => e.date >= start && e.date <= shiftDate(today, 1))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const weights = [...user.weights.values()]
    .filter(w => w.date >= start && w.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const weightTrendSeed = [...user.weights.values()]
    .filter(w => !w.deleted && w.date >= shiftDate(start, -56) && w.date < start)
    .sort((a, b) => a.date.localeCompare(b.date));
  const days = [...user.days.values()].filter(d => d.date >= start && d.date <= today);
  const plans = [...user.plans].sort((a, b) => b.revision - a.revision).slice(0, 12);
  const checkIns = [...user.checkIns].sort((a, b) => b.revision - a.revision).slice(0, 12);
  const phaseDecisions = [...user.phaseDecisions].sort((a, b) => b.revision - a.revision).slice(0, 12);

  return {
    id: user.id,
    displayName: user.displayName,
    revision: user.revision,
    profileRevision: user.profileRevision,
    diaryRevision: user.diaryRevision,
    trajectoryRevision: user.trajectoryRevision,
    bodyRevision: user.bodyRevision,
    foodRevision: user.foodRevision,
    settings: user.settings,
    profile: user.profile,
    start,
    end: today,
    detailCutoff,
    detailDays,
    energyEstimates: buildEnergyEstimates(user, start, today),
    acceptedTargetIntervals: buildAcceptedTargetIntervals(user.plans, today),
    entries,
    ...(includeFoods
      ? {
          foods: [...user.foods.values()].filter(f => !f.deleted).sort((a, b) => a.name.localeCompare(b.name)),
          trainingSummaries: []
        }
      : {}),
    weights,
    weightTrendSeed,
    days,
    plans,
    checkIns,
    phaseDecisions,
    workoutConnected: false,
    workoutWarning: null
  };
}

function buildCoachPreview(user: UserStore): CoachPreview {
  if (!user.profile) {
    throw { status: 400, message: 'Complete your coaching profile first.' };
  }
  const today = currentIsoDate(user.profile.timeZone);
  const activePlans = user.plans.filter(p => !p.deleted).sort((a, b) => b.revision - a.revision);
  const lastPlan = activePlans[0] ?? null;
  const accepted = lastPlan ? (JSON.parse(lastPlan.resultJson) as CoachResult) : null;
  const live = calculateLivePace(
    { ...user.profile, sex: user.profile.sex, goal: user.profile.goal },
    undefined,
    accepted?.expenditure ?? user.profile.maintenance,
    today
  );
  const activeWeights = [...user.weights.values()].filter(w => !w.deleted);
  const currentPhaseDecision =
    user.phaseDecisions.find(d => !d.deleted && d.profileRevision === user.profileRevision);
  const goalProgress = liveGoalProgress(
    user.profile,
    activeWeights,
    today,
    currentPhaseDecision,
    user.settings.weightGoalMetric ?? 'scale'
  );

  const result: CoachResult = {
    eligible: !live.carbsBlocked,
    adaptive: activeWeights.length >= 3,
    calories: live.target,
    expenditure: live.expenditure,
    protein: live.protein,
    fat: live.fat,
    carbs: live.carbs,
    explanation:
      live.carbsBlocked
        ? 'Protein and fat exceed the calorie target.'
        : 'Recommendation is aligned with your current profile, logged intake, and weight trend.',
    version: '2.0',
    weeklyCalories: live.weeklyCalories,
    dailyCalories: live.dailyCalories,
    goalRatePercent: live.goalRatePercent,
    effectiveGoal: user.profile.goal,
    phaseComplete: goalProgress?.complete ?? false,
    goalProgress: goalProgress ?? undefined,
    proteinFixed: !user.profile.proteinPercent
  };

  const weekday = user.settings.checkInWeekday ?? 1;
  const weekStart = periodStart(today, weekday);
  const nextCheckIn = lastPlan ? nextOccurrence(shiftDate(lastPlan.date, 7), weekday) : weekStart;
  const newWeek = lastPlan != null && today >= nextCheckIn;
  const due = lastPlan == null || lastPlan.profileRevision !== user.profileRevision || newWeek;

  const changes = accepted
    ? {
        previousCalories: accepted.calories,
        proposedCalories: result.calories,
        previousExpenditure: accepted.expenditure,
        proposedExpenditure: result.expenditure,
        previousProtein: accepted.protein,
        proposedProtein: result.protein,
        previousCarbs: accepted.carbs,
        proposedCarbs: result.carbs,
        previousFat: accepted.fat,
        proposedFat: result.fat,
        previousEffectiveGoal: accepted.effectiveGoal ?? user.profile.goal,
        proposedEffectiveGoal: result.effectiveGoal ?? user.profile.goal
      }
    : null;

  return {
    revision: user.revision,
    result,
    canAccept: result.eligible && due,
    holdReason: due ? null : `Your next check-in is available on ${nextCheckIn}.`,
    weekStart,
    nextCheckIn,
    changes,
    evidence: {
      windowDays: 14,
      loggedDays: 10,
      coverage: 0.71,
      weighIns: activeWeights.length,
      weighInSpanDays: 14,
      meanIntake: live.target,
      slopeKgPerDay: -0.05,
      noiseKg: 0.2,
      waterFlaggedDays: 0,
      confidence: 0.85
    }
  };
}

function buildProgressSummary(user: UserStore, requestedPeriod?: string): ProgressSummary {
  const period: ProgressPeriod =
    requestedPeriod === 'week' ||
    requestedPeriod === 'month' ||
    requestedPeriod === 'six-months' ||
    requestedPeriod === 'year' ||
    requestedPeriod === 'all'
      ? requestedPeriod
      : 'month';
  const today = currentIsoDate(user.profile?.timeZone);
  const allDates = [
    ...[...user.entries.values()].filter(e => !e.deleted).map(e => e.date),
    ...[...user.weights.values()].filter(w => !w.deleted).map(w => w.date),
    ...user.plans.filter(p => !p.deleted).map(p => p.date)
  ].sort();
  const { start, end } = progressRange(period, today, allDates[0] ?? today);

  const smoothedAll = computeSmoothedWeights([...user.weights.values()]);
  const series: ProgressWeightPoint[] = smoothedAll.filter(p => p.date >= start && p.date <= end);
  const scaleValues = series.map(p => p.scaleKg);
  const editableWeighIns = [...user.weights.values()]
    .filter(w => !w.deleted && w.date >= start && w.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  const weightSummary = {
    statistics: {
      count: scaleValues.length,
      averageKg: scaleValues.length ? scaleValues.reduce((a, b) => a + b, 0) / scaleValues.length : null,
      minimumKg: scaleValues.length ? Math.min(...scaleValues) : null,
      maximumKg: scaleValues.length ? Math.max(...scaleValues) : null,
      firstKg: scaleValues[0] ?? null,
      latestKg: scaleValues[scaleValues.length - 1] ?? null,
      latestTrendKg: series.length ? series[series.length - 1].trendKg : null,
      trendChangeKg: series.length >= 2 ? series[series.length - 1].trendKg! - series[0].trendKg! : null
    },
    series,
    editableWeighIns
  };

  const activePlans = user.plans.filter(p => !p.deleted).sort((a, b) => b.revision - a.revision);
  const maintenance = activePlans[0]
    ? ((JSON.parse(activePlans[0].resultJson) as CoachResult).expenditure ?? user.profile?.maintenance ?? 2150)
    : (user.profile?.maintenance ?? 2150);

  const entriesByDate = new Map<string, number>();
  for (const e of user.entries.values()) {
    if (e.deleted || e.date < start || e.date > end) continue;
    entriesByDate.set(e.date, (entriesByDate.get(e.date) ?? 0) + e.calories);
  }

  const dailyBuckets: ProgressEnergyBucket[] = [];
  let cursor = start;
  while (cursor <= end) {
    const hasFood = entriesByDate.has(cursor);
    const intake = hasFood ? Math.round(entriesByDate.get(cursor)!) : null;
    const complete = cursor < today ? hasFood : hasFood;
    const balance = complete && intake != null ? intake - maintenance : null;
    dailyBuckets.push({
      date: cursor,
      end: cursor,
      intake,
      maintenance,
      balance,
      complete,
      days: 1,
      loggedDays: intake != null ? 1 : 0
    });
    cursor = shiftDate(cursor, 1);
  }

  const knownIntakes = dailyBuckets.filter(b => b.intake != null).map(b => b.intake!);
  const balances = dailyBuckets.filter(b => b.balance != null).map(b => b.balance!);
  const energyGrouping: 'daily' | 'weekly' | 'monthly' =
    period === 'six-months' ? 'weekly' : period === 'year' ? 'monthly' : 'daily';

  return {
    period,
    start,
    end,
    revision: user.revision,
    grouping: { weight: 'daily', energy: energyGrouping },
    weight: weightSummary,
    energy: {
      statistics: {
        days: dailyBuckets.length,
        loggedDays: dailyBuckets.reduce((sum, b) => sum + b.loggedDays, 0),
        completeDays: dailyBuckets.filter(b => b.complete).length,
        totalIntake: knownIntakes.length ? knownIntakes.reduce((a, b) => a + b, 0) : null,
        averageIntake: knownIntakes.length
          ? knownIntakes.reduce((a, b) => a + b, 0) / knownIntakes.length
          : null,
        averageMaintenance: maintenance,
        totalBalance: balances.length ? balances.reduce((a, b) => a + b, 0) : null,
        surplusDays: balances.filter(v => v > 0).length,
        deficitDays: balances.filter(v => v < 0).length
      },
      series: dailyBuckets
    }
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Auth endpoints
  app.post('/api/auth/dev-reset', (_req: Request, res: Response) => {
    users.clear();
    signedOutSession = false;
    res.json({ reset: true });
  });

  app.get('/api/auth/central/start', (_req: Request, res: Response) => {
    signedOutSession = false;
    getUser();
    res.redirect('/?auth=1');
  });

  app.get('/api/auth/central/callback', (_req: Request, res: Response) => {
    signedOutSession = false;
    getUser();
    res.redirect('/?auth=1');
  });

  app.get('/api/auth/central/connect', (_req: Request, res: Response) => {
    res.redirect('/settings');
  });

  app.get('/api/auth/me', (_req: Request, res: Response) => {
    if (signedOutSession) {
      res.status(401).json({ message: 'Sign in to sync your diary.' });
      return;
    }
    const user = getUser();
    res.json({ id: user.id, displayName: user.displayName });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    signedOutSession = true;
    res.status(204).end();
  });

  // Revisions & Bootstrap & State
  app.get('/api/revisions', (req: Request, res: Response) => {
    const user = getUser();
    const localDay = currentIsoDate(user.profile?.timeZone);
    const etag = `"revisions:${user.id}:${user.revision}:${user.profileRevision}:${user.settings.revision}:${user.trajectoryRevision}:${user.foodRevision}:${user.diaryRevision}:${user.bodyRevision}:0:0:${localDay}:90"`;
    if (req.headers['if-none-match'] === etag) {
      res.setHeader('ETag', etag);
      res.status(304).end();
      return;
    }
    res.setHeader('ETag', etag);
    res.json({
      account: user.revision,
      profile: user.profileRevision,
      settings: user.settings.revision,
      trajectory: user.trajectoryRevision,
      foods: user.foodRevision,
      diary: user.diaryRevision,
      body: user.bodyRevision,
      training: 0,
      google: 0,
      localDay,
      detailDays: 90
    });
  });

  app.get('/api/bootstrap', (req: Request, res: Response) => {
    const user = getUser();
    const localDay = currentIsoDate(user.profile?.timeZone);
    const etag = `"bootstrap:${user.id}:${user.revision}:${localDay}"`;
    if (req.headers['if-none-match'] === etag) {
      res.setHeader('ETag', etag);
      res.status(304).end();
      return;
    }
    res.setHeader('ETag', etag);
    res.json(buildBootstrapPayload(user, false));
  });

  app.get('/api/state', (_req: Request, res: Response) => {
    const user = getUser();
    res.json(buildBootstrapPayload(user, true));
  });

  app.get('/api/diary', (req: Request, res: Response) => {
    const user = getUser();
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    const today = currentIsoDate(user.profile?.timeZone);
    const entries = [...user.entries.values()]
      .filter(e => e.date >= from && e.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const days = [...user.days.values()].filter(d => d.date >= from && d.date <= to);
    res.json({
      from,
      to,
      revision: user.revision,
      detailCutoff: shiftDate(today, -89),
      detailDays: 90,
      entries,
      days
    });
  });

  app.get('/api/foods', (req: Request, res: Response) => {
    const user = getUser();
    const etag = `"foods:${user.id}:${user.foodRevision}"`;
    if (req.headers['if-none-match'] === etag) {
      res.setHeader('ETag', etag);
      res.status(304).end();
      return;
    }
    res.setHeader('ETag', etag);
    const foods = [...user.foods.values()]
      .filter(f => !f.deleted)
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      foods,
      revision: user.revision,
      foodRevision: user.foodRevision
    });
  });

  // Sync mutations
  app.post('/api/sync', (req: Request, res: Response) => {
    const user = getUser();
    const op = req.body as Mutation;
    if (!op || !op.id || !op.recordId) {
      res.status(400).json({ message: 'Mutation identity is required.' });
      return;
    }
    const existingReceipt = user.receipts.get(op.id);
    if (existingReceipt) {
      res.json(existingReceipt.data ?? { revision: existingReceipt.revision });
      return;
    }

    const revision = ++user.revision;
    let changedDays: Day[] | null = null;
    let changedWeights: Weight[] | null = null;

    switch (op.kind) {
      case 'profile': {
        const nextProfile = op.data as Profile;
        user.profile = nextProfile;
        user.profileRevision = revision;
        user.trajectoryRevision = revision;
        break;
      }
      case 'settings': {
        const patch = op.data as Partial<CoachingSettings>;
        const today = currentIsoDate(user.profile?.timeZone);
        if (patch.checkInWeekday !== undefined && patch.checkInWeekday !== user.settings.checkInWeekday) {
          user.settings.cadenceRevision = revision;
          user.settings.cadenceChangedDate = today;
        }
        user.settings = {
          ...user.settings,
          ...patch,
          revision,
          changedDate: today
        };
        break;
      }
      case 'entry': {
        const data = op.data as Partial<Entry>;
        const existing = user.entries.get(op.recordId);
        if (op.delete) {
          if (existing) {
            user.entries.set(op.recordId, { ...existing, deleted: true, revision });
          }
        } else {
          const next: Entry = {
            id: op.recordId,
            revision,
            deleted: false,
            date: data.date ?? existing?.date ?? currentIsoDate(user.profile?.timeZone),
            time: data.time !== undefined ? data.time : (existing?.time ?? null),
            name: data.name ?? existing?.name ?? 'Food',
            calories: data.calories ?? existing?.calories ?? 0,
            protein: data.protein !== undefined ? data.protein : (existing?.protein ?? null),
            carbs: data.carbs !== undefined ? data.carbs : (existing?.carbs ?? null),
            fat: data.fat !== undefined ? data.fat : (existing?.fat ?? null),
            fiber: data.fiber !== undefined ? data.fiber : (existing?.fiber ?? null),
            source: data.source ?? existing?.source ?? 'manual',
            portionLabel: data.portionLabel !== undefined ? data.portionLabel : (existing?.portionLabel ?? null),
            portionGrams: data.portionGrams !== undefined ? data.portionGrams : (existing?.portionGrams ?? null),
            quantity: data.quantity ?? existing?.quantity ?? 100,
            unit: data.unit ?? existing?.unit ?? 'g',
            measure: data.measure ?? existing?.measure ?? 'g'
          };
          user.entries.set(op.recordId, next);
          for (const d of user.days.values()) {
            if (d.date === next.date) {
              d.status = 'incomplete';
              d.revision = revision;
            }
          }
        }
        user.diaryRevision = revision;
        user.trajectoryRevision = revision;
        break;
      }
      case 'food': {
        const data = op.data as Partial<Food>;
        const existing = user.foods.get(op.recordId);
        if (op.delete) {
          if (existing) {
            user.foods.set(op.recordId, { ...existing, deleted: true, revision });
          }
        } else {
          const next: Food = {
            id: op.recordId,
            revision,
            deleted: false,
            name: data.name ?? existing?.name ?? 'Saved food',
            calories: data.calories ?? existing?.calories ?? 0,
            protein: data.protein !== undefined ? data.protein : (existing?.protein ?? null),
            carbs: data.carbs !== undefined ? data.carbs : (existing?.carbs ?? null),
            fat: data.fat !== undefined ? data.fat : (existing?.fat ?? null),
            fiber: data.fiber !== undefined ? data.fiber : (existing?.fiber ?? null),
            source: data.source ?? existing?.source ?? 'custom',
            servingGrams: data.servingGrams ?? existing?.servingGrams ?? 100,
            measure: data.measure ?? existing?.measure ?? 'g',
            favourite: data.favourite ?? existing?.favourite ?? false,
            barcode: data.barcode !== undefined ? data.barcode : (existing?.barcode ?? null),
            ingredientsJson: data.ingredientsJson ?? existing?.ingredientsJson ?? '[]',
            portionsJson: data.portionsJson ?? existing?.portionsJson ?? '[]',
            cookedYieldGrams:
              data.cookedYieldGrams !== undefined ? data.cookedYieldGrams : (existing?.cookedYieldGrams ?? null)
          };
          user.foods.set(op.recordId, next);
        }
        user.foodRevision = revision;
        break;
      }
      case 'weight': {
        const data = op.data as Partial<Weight>;
        const existing = user.weights.get(op.recordId);
        if (op.delete) {
          if (existing) {
            const updated: Weight = { ...existing, deleted: true, revision };
            user.weights.set(op.recordId, updated);
            changedWeights = [updated];
          }
        } else {
          const next: Weight = {
            id: op.recordId,
            revision,
            deleted: false,
            date: data.date ?? existing?.date ?? currentIsoDate(user.profile?.timeZone),
            kg: data.kg ?? existing?.kg ?? 70,
            context: data.context !== undefined ? data.context : (existing?.context ?? null),
            source: 'manual'
          };
          user.weights.set(op.recordId, next);
          changedWeights = [next];
        }
        user.trajectoryRevision = revision;
        break;
      }
      case 'weight_move': {
        const data = op.data as {
          date: string;
          kg: number;
          context?: Weight['context'];
          destinationId?: string;
        };
        const source = user.weights.get(op.recordId);
        const destId = data.destinationId ?? op.recordId;
        const resultWeights: Weight[] = [];
        if (source && destId !== op.recordId) {
          const deletedSource: Weight = { ...source, deleted: true, revision };
          user.weights.set(op.recordId, deletedSource);
          resultWeights.push(deletedSource);
        }
        const dest: Weight = {
          id: destId,
          revision,
          deleted: false,
          date: data.date,
          kg: data.kg,
          context: data.context ?? null,
          source: 'manual'
        };
        user.weights.set(destId, dest);
        resultWeights.push(dest);
        changedWeights = resultWeights;
        user.trajectoryRevision = revision;
        break;
      }
      case 'day': {
        const data = op.data as Partial<Day>;
        const existing = user.days.get(op.recordId);
        if (op.delete) {
          if (existing) {
            const updated: Day = { ...existing, deleted: true, revision };
            user.days.set(op.recordId, updated);
            changedDays = [updated];
          }
        } else {
          const next: Day = {
            id: op.recordId,
            revision,
            deleted: false,
            date: data.date ?? existing?.date ?? currentIsoDate(user.profile?.timeZone),
            status: data.status ?? existing?.status ?? 'incomplete'
          };
          user.days.set(op.recordId, next);
          changedDays = [next];
        }
        user.diaryRevision = revision;
        user.trajectoryRevision = revision;
        break;
      }
    }

    const ack = {
      revision,
      ...(changedDays ? { days: changedDays } : {}),
      ...(changedWeights ? { weights: changedWeights } : {})
    };
    user.receipts.set(op.id, { revision, data: ack });
    res.json(ack);
  });

  // Coaching endpoints
  app.get('/api/coach/preview', (_req: Request, res: Response) => {
    try {
      const user = getUser();
      res.json(buildCoachPreview(user));
    } catch (err) {
      const e = err as { status?: number; message?: string };
      res.status(e.status ?? 400).json({ message: e.message ?? 'Could not build coaching preview.' });
    }
  });

  app.post('/api/coach/accept', (req: Request, res: Response) => {
    const user = getUser();
    const { id, revision: inputRevision } = req.body as { id: string; revision: number };
    const preview = buildCoachPreview(user);
    const revision = ++user.revision;
    const today = currentIsoDate(user.profile?.timeZone);
    const plan: Plan = {
      id: id || crypto.randomUUID(),
      revision,
      deleted: false,
      date: today,
      inputRevision: inputRevision ?? preview.revision,
      profileRevision: user.profileRevision,
      coachingSettingsRevision: user.settings.revision,
      cadenceRevision: user.settings.cadenceRevision,
      cadenceChangedDate: user.settings.cadenceChangedDate,
      checkInWeekday: user.settings.checkInWeekday,
      resultJson: JSON.stringify(preview.result)
    };
    user.plans.push(plan);
    res.json(plan);
  });

  app.post('/api/coach/decline', (req: Request, res: Response) => {
    const user = getUser();
    const { id, revision: inputRevision } = req.body as { id: string; revision: number };
    const preview = buildCoachPreview(user);
    const revision = ++user.revision;
    const today = currentIsoDate(user.profile?.timeZone);
    const decision: CheckInDecision = {
      id: id || crypto.randomUUID(),
      revision,
      deleted: false,
      weekStart: preview.weekStart,
      checkInWeekday: user.settings.checkInWeekday,
      date: today,
      decision: 'declined',
      inputRevision: inputRevision ?? preview.revision,
      resultJson: JSON.stringify(preview.result)
    };
    user.checkIns.push(decision);
    res.json(decision);
  });

  app.post('/api/goal/complete', (req: Request, res: Response) => {
    const user = getUser();
    const { id, decision } = req.body as { id: string; revision: number; decision: string };
    const revision = ++user.revision;
    const today = currentIsoDate(user.profile?.timeZone);
    const phaseDecision: PhaseDecision = {
      id: id || crypto.randomUUID(),
      revision,
      deleted: false,
      date: today,
      profileRevision: user.profileRevision,
      reachedBy: decision === 'await-trend' ? 'scale' : 'trend',
      decision
    };
    user.phaseDecisions = user.phaseDecisions.filter(d => d.profileRevision !== user.profileRevision);
    user.phaseDecisions.push(phaseDecision);
    res.json(phaseDecision);
  });

  // Progress summary
  app.get('/api/progress/summary', (req: Request, res: Response) => {
    const user = getUser();
    const period = typeof req.query.period === 'string' ? req.query.period : 'month';
    const summary = buildProgressSummary(user, period);
    const etag = `"progress:${user.id}:${summary.period}:${summary.start}:${summary.end}:${user.revision}"`;
    if (req.headers['if-none-match'] === etag) {
      res.setHeader('ETag', etag);
      res.status(304).end();
      return;
    }
    res.setHeader('ETag', etag);
    res.json(summary);
  });

  // Food search, verify, barcode
  app.get('/api/foods/search', (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const queryTokens = tokenize(q);
    if (!queryTokens.length) {
      res.json([]);
      return;
    }
    const dataset = loadUsdaDataset();
    const scored: Array<{ result: FoodSearchResult; score: number }> = [];
    for (const item of dataset) {
      let matched = 0;
      for (const qt of queryTokens) {
        if (item.tokens.some(t => t.startsWith(qt))) matched++;
      }
      if (matched === 0) continue;
      const allMatched = matched === queryTokens.length ? 100 : matched * 25;
      const exactLead = item.tokens[0] === queryTokens[0] ? 30 : 0;
      const brevity = Math.max(0, 20 - item.tokens.length);
      scored.push({
        result: item.result,
        score: allMatched + exactLead + brevity
      });
    }
    scored.sort((a, b) => b.score - a.score || a.result.name.localeCompare(b.result.name));
    res.json(scored.slice(0, 25).map(s => s.result));
  });

  app.get('/api/foods/verify', (_req: Request, res: Response) => {
    res.json({ verified: [] });
  });

  app.get('/api/foods/barcode/:code', (req: Request, res: Response) => {
    const user = getUser();
    const code = String(req.params.code ?? '').trim();
    const saved = [...user.foods.values()].find(f => !f.deleted && f.barcode === code);
    if (saved) {
      res.json({
        name: saved.name,
        calories: saved.calories,
        protein: saved.protein,
        fat: saved.fat,
        carbs: saved.carbs,
        fiber: saved.fiber,
        source: 'Saved food',
        servingGrams: saved.servingGrams,
        code,
        basis: 'per100g',
        measure: saved.measure ?? 'g'
      });
      return;
    }
    res.status(404).json({ message: 'No product found for that barcode.' });
  });

  // Scans & AI meal estimation
  app.post('/api/scans', (_req: Request, res: Response) => {
    const id = crypto.randomUUID();
    res.json({ id, status: 'pending' });
  });

  app.post('/api/scans/:id/process', (_req: Request, res: Response) => {
    res.json({
      foods: [
        {
          name: 'Grilled chicken salad bowl',
          quantity: 1,
          unit: 'serving',
          portionLabel: '1 bowl',
          portionGrams: 350,
          calories: 460,
          protein: 42,
          fat: 18,
          carbs: 32,
          fiber: 6,
          notes: 'Estimated from meal description'
        }
      ],
      questions: [],
      explanation: 'Estimated standard portion weights for the described meal.'
    });
  });

  app.get('/api/scans/:id', (req: Request, res: Response) => {
    res.json({ id: req.params.id, status: 'completed' });
  });

  // Body records & photos
  app.get('/api/body-records', (_req: Request, res: Response) => {
    const user = getUser();
    const records = [...user.bodyRecords.values()]
      .filter(r => !r.deleted)
      .sort((a, b) => b.date.localeCompare(a.date));
    res.json({
      accountId: user.id,
      revision: user.bodyRevision,
      configured: true,
      usedBytes: 0,
      maxBytes: 50 * 1024 * 1024,
      records,
      nextCursor: null,
      hasMore: false
    });
  });

  app.get('/api/body-records/weight-context', (req: Request, res: Response) => {
    const user = getUser();
    const date = String(req.query.date ?? currentIsoDate(user.profile?.timeZone));
    const smoothed = computeSmoothedWeights([...user.weights.values()]).filter(w => w.date <= date);
    const latest = smoothed[smoothed.length - 1];
    res.json({
      scaleKg: latest?.scaleKg ?? null,
      scaleDate: latest?.date ?? null,
      trendKg: latest?.trendKg ?? null,
      trendDate: latest?.date ?? null,
      capturedAt: new Date().toISOString(),
      calculationVersion: '2.0',
      provenance: 'server'
    });
  });

  app.get('/api/body-records/:id', (req: Request, res: Response) => {
    const user = getUser();
    const record = user.bodyRecords.get(String(req.params.id));
    if (!record) {
      res.status(404).json({ message: 'Body record not found.' });
      return;
    }
    res.json(record);
  });

  app.post('/api/body-records/:id', (req: Request, res: Response) => {
    const user = getUser();
    const id = String(req.params.id);
    const input = req.body as {
      mutationId?: string;
      date?: string;
      delete?: boolean;
      measurements?: BodyRecord['measurements'];
      weightContext?: BodyRecord['weightContext'];
    };
    const revision = ++user.revision;
    user.bodyRevision = revision;
    const existing = user.bodyRecords.get(id);
    const now = new Date().toISOString();
    const record: BodyRecord = {
      id,
      date: input.date ?? existing?.date ?? currentIsoDate(user.profile?.timeZone),
      creationOrder: existing?.creationOrder ?? user.bodyRecords.size + 1,
      revision,
      deleted: Boolean(input.delete),
      created: existing?.created ?? now,
      updated: now,
      measurements: {
        neckCm: null,
        shouldersCm: null,
        chestCm: null,
        waistCm: null,
        hipsCm: null,
        leftBicepsCm: null,
        rightBicepsCm: null,
        leftForearmCm: null,
        rightForearmCm: null,
        leftThighCm: null,
        rightThighCm: null,
        leftCalfCm: null,
        rightCalfCm: null,
        bodyFatPercent: null,
        ...(existing?.measurements ?? {}),
        ...(input.measurements ?? {})
      },
      weightContext: input.weightContext ??
        existing?.weightContext ?? {
          scaleKg: null,
          scaleDate: null,
          trendKg: null,
          trendDate: null,
          capturedAt: now,
          calculationVersion: '2.0',
          provenance: 'server'
        },
      photos: existing?.photos ?? []
    };
    user.bodyRecords.set(id, record);
    if (input.mutationId) user.receipts.set(input.mutationId, { revision, data: record });
    res.json(record);
  });

  app.post('/api/body-records/:id/photos', (req: Request, res: Response) => {
    const user = getUser();
    const id = String(req.params.id);
    const input = req.body as {
      date?: string;
      photos?: Array<{ id: string; angle: 'front' | 'side' | 'back'; imageBase64: string }>;
    };
    const revision = ++user.revision;
    user.bodyRevision = revision;
    const existing = user.bodyRecords.get(id);
    const uploaded: PhysiquePhoto[] = (input.photos ?? []).map(p => {
      const buf = Buffer.from(p.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      user.photoBlobs.set(p.id, buf);
      return {
        id: p.id,
        setId: id,
        date: input.date ?? existing?.date ?? currentIsoDate(user.profile?.timeZone),
        angle: p.angle,
        bytes: buf.length,
        status: 'stored'
      };
    });
    if (existing) {
      existing.photos = [...existing.photos.filter(ep => !uploaded.some(u => u.angle === ep.angle)), ...uploaded];
      existing.revision = revision;
    }
    res.json({ revision, photos: uploaded });
  });

  app.post('/api/body-records/body-fat-estimate', (_req: Request, res: Response) => {
    res.json({
      lowPercent: 18,
      highPercent: 22,
      midpointPercent: 20,
      explanation: 'Estimated from your profile and recorded measurements.'
    });
  });

  app.get('/api/photos', (_req: Request, res: Response) => {
    res.json({
      configured: true,
      usedBytes: 0,
      maxBytes: 50 * 1024 * 1024,
      sets: [],
      nextCursor: null,
      hasMore: false
    });
  });

  app.get('/api/photos/:id/content', (req: Request, res: Response) => {
    const user = getUser();
    const blob = user.photoBlobs.get(String(req.params.id));
    if (!blob) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(blob);
  });

  app.post('/api/photos/:id/delete', (req: Request, res: Response) => {
    const user = getUser();
    user.photoBlobs.delete(String(req.params.id));
    res.status(204).end();
  });

  // Training summaries
  app.get('/api/training/summary', (_req: Request, res: Response) => {
    res.json({
      summaries: [],
      lastSuccessAt: null,
      workoutConnected: false,
      workoutWarning: null
    });
  });

  app.get('/api/training', (_req: Request, res: Response) => {
    res.json({
      summaries: [],
      lastSuccessAt: null,
      workoutConnected: false,
      workoutWarning: null
    });
  });

  app.get('/api/integrations/connected', (_req: Request, res: Response) => {
    res.json([]);
  });

  app.delete('/api/integrations/connected/workout', (_req: Request, res: Response) => {
    res.status(204).end();
  });

  // Notifications
  app.get('/api/notifications/status', (req: Request, res: Response) => {
    const user = getUser();
    const deviceId = String(req.query.deviceId ?? '');
    res.json({
      configured: false,
      thisDeviceSubscribed: deviceId ? user.reminder.devices.has(deviceId) : false,
      reminderEnabled: user.reminder.enabled,
      weekday: user.reminder.weekday,
      localTime: user.reminder.localTime,
      timeZoneId: user.reminder.timeZoneId
    });
  });

  app.get('/api/notifications/check-in-reminder', (_req: Request, res: Response) => {
    const user = getUser();
    res.json({
      enabled: user.reminder.enabled,
      weekday: user.reminder.weekday,
      localTime: user.reminder.localTime,
      timeZoneId: user.reminder.timeZoneId
    });
  });

  app.post('/api/notifications/check-in-reminder', (req: Request, res: Response) => {
    const user = getUser();
    const body = req.body as { enabled: boolean; weekday: number; localTime: string; timeZoneId: string };
    user.reminder.enabled = Boolean(body.enabled);
    if (typeof body.weekday === 'number') user.reminder.weekday = body.weekday;
    if (typeof body.localTime === 'string') user.reminder.localTime = body.localTime;
    if (typeof body.timeZoneId === 'string') user.reminder.timeZoneId = body.timeZoneId;
    res.json({
      enabled: user.reminder.enabled,
      weekday: user.reminder.weekday,
      localTime: user.reminder.localTime,
      timeZoneId: user.reminder.timeZoneId
    });
  });

  app.post('/api/notifications/subscriptions', (req: Request, res: Response) => {
    const user = getUser();
    const { deviceId } = req.body as { deviceId?: string };
    if (deviceId) user.reminder.devices.add(deviceId);
    res.json({ subscribed: true });
  });

  app.delete('/api/notifications/subscriptions/:deviceId', (req: Request, res: Response) => {
    const user = getUser();
    user.reminder.devices.delete(String(req.params.deviceId));
    res.status(204).end();
  });

  app.post('/api/notifications/subscriptions/revoke', (req: Request, res: Response) => {
    const user = getUser();
    const { deviceId } = req.body as { deviceId?: string };
    if (deviceId) user.reminder.devices.delete(deviceId);
    res.status(204).end();
  });

  // Google Health
  const googleHealthDisconnected = {
    connected: false,
    configured: false,
    syncWeight: false,
    syncNutrition: false,
    syncBodyFat: false,
    importWeight: false,
    revision: 0,
    days: [],
    lastSyncedAt: null,
    warning: null,
    weightSyncStatus: null,
    nutritionSyncStatus: null,
    bodyFatSyncStatus: null,
    weightImportStatus: null
  };

  app.post('/api/integrations/google-health/sync', (_req: Request, res: Response) => {
    res.json(googleHealthDisconnected);
  });

  app.post('/api/integrations/google-health/sync-data', (_req: Request, res: Response) => {
    res.json(googleHealthDisconnected);
  });

  app.post('/api/integrations/google-health/disconnect', (_req: Request, res: Response) => {
    res.json(googleHealthDisconnected);
  });

  // AI Assistant endpoints
  app.get('/api/ai/conversation', (_req: Request, res: Response) => {
    const user = getUser();
    res.json(user.conversation);
  });

  app.delete('/api/ai/conversation', (_req: Request, res: Response) => {
    const user = getUser();
    user.conversation = {
      conversationId: crypto.randomUUID(),
      version: 1,
      messages: []
    };
    res.status(204).end();
  });

  app.post('/api/ai/action-batches/:batchId/resolve', (req: Request, res: Response) => {
    const user = getUser();
    const batchId = String(req.params.batchId);
    const { resolution } = req.body as { resolution?: 'accepted' | 'dismissed' };
    for (const msg of user.conversation.messages) {
      if (msg.actionBatch && msg.actionBatch.batchId === batchId) {
        msg.actionBatch.status = resolution === 'accepted' ? 'accepted' : 'dismissed';
      }
    }
    user.conversation.version += 1;
    res.status(204).end();
  });

  app.post('/api/ai/chat', (req: Request, res: Response) => {
    const user = getUser();
    const { message } = req.body as { message?: string };
    const today = currentIsoDate(user.profile?.timeZone);
    const todayEntries = [...user.entries.values()].filter(e => !e.deleted && e.date === today);
    const totalCalories = Math.round(todayEntries.reduce((s, e) => s + e.calories, 0));
    const totalProtein = Math.round(todayEntries.reduce((s, e) => s + (e.protein ?? 0), 0));

    user.conversation.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: message ?? '',
      createdAt: new Date().toISOString()
    });
    const reply = `Today (${today}) you have logged **${totalCalories} kcal** and **${totalProtein} g protein** across ${todayEntries.length} food entries.`;
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: reply,
      createdAt: new Date().toISOString(),
      actionBatch: null
    };
    user.conversation.messages.push(assistantMsg);
    user.conversation.version += 1;
    res.json({
      conversationId: user.conversation.conversationId,
      version: user.conversation.version,
      reply,
      actions: [],
      actionBatch: null
    });
  });

  app.post('/api/ai/chat/stream', (req: Request, res: Response) => {
    const user = getUser();
    const { message } = req.body as { message?: string };
    const today = currentIsoDate(user.profile?.timeZone);
    const todayEntries = [...user.entries.values()].filter(e => !e.deleted && e.date === today);
    const totalCalories = Math.round(todayEntries.reduce((s, e) => s + e.calories, 0));
    const totalProtein = Math.round(todayEntries.reduce((s, e) => s + (e.protein ?? 0), 0));

    user.conversation.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: message ?? '',
      createdAt: new Date().toISOString()
    });
    const reply = `Today (${today}) you have logged **${totalCalories} kcal** and **${totalProtein} g protein** across ${todayEntries.length} food entries.`;
    user.conversation.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: reply,
      createdAt: new Date().toISOString(),
      actionBatch: null
    });
    user.conversation.version += 1;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`event: delta\ndata: ${JSON.stringify({ text: reply })}\n\n`);
    res.write(
      `event: done\ndata: ${JSON.stringify({
        conversationId: user.conversation.conversationId,
        version: user.conversation.version,
        reply,
        actions: [],
        actionBatch: null
      })}\n\n`
    );
    res.end();
  });

  app.get('/api/storage', (_req: Request, res: Response) => {
    const user = getUser();
    res.json({
      entries: user.entries.size,
      foods: user.foods.size,
      weights: user.weights.size,
      days: user.days.size,
      photos: user.photoBlobs.size,
      usedBytes: 0,
      maxBytes: 50 * 1024 * 1024
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      root: webDir,
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*splat', (req: Request, res: Response) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ message: 'Not found' });
        return;
      }
      res.sendFile(join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Nutrition server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();
