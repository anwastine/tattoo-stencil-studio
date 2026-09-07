/*
 * Business rules in one place. Change a number here and the whole app follows:
 * the UI reads these values from GET /api/config.
 */

/** Free credits granted once, the first time a person signs in with Google. */
export const WELCOME_CREDITS = 29

/** Rupees per credit. Displayed everywhere; orders are created in paise. */
export const RUPEES_PER_CREDIT = 9

/**
 * Credits burned per generation, by output size.
 *
 * NOTE ON MARGIN: at ₹9 a credit, one credit ≈ US$0.10, but a 2K render costs
 * roughly $0.30–0.45 and a 4K render more, so 2K and 4K currently sell below
 * cost. To make every size profitable, change this to:
 *     export const CREDIT_COST = { '1K': 1, '2K': 4, '4K': 8 }
 * The UI picks the numbers up automatically — nothing else needs editing.
 */
export const CREDIT_COST = { '1K': 1, '2K': 1, '4K': 1 }

export const creditCostFor = (size) => CREDIT_COST[size] ?? 1

/** Recharge packs. Straight ₹9 per credit, no bonus, so the maths stays obvious. */
export const PACKS = [
  { id: 'p10', credits: 10 },
  { id: 'p25', credits: 25 },
  { id: 'p50', credits: 50 },
  { id: 'p100', credits: 100 },
]

export const packById = (id) => PACKS.find((p) => p.id === id) || null

/** Razorpay works in paise. */
export const paiseFor = (credits) => credits * RUPEES_PER_CREDIT * 100

/** Anti-abuse limits. */
export const LIMITS = {
  generationsPerHour: 30, // per user
  generationsPerDay: 120, // per user
  concurrentGenerations: 1, // one render at a time per user
}

export const publicConfig = () => ({
  welcomeCredits: WELCOME_CREDITS,
  rupeesPerCredit: RUPEES_PER_CREDIT,
  creditCost: CREDIT_COST,
  packs: PACKS.map((p) => ({ ...p, rupees: p.credits * RUPEES_PER_CREDIT })),
})
