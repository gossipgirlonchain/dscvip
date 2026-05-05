// Animation springs (carried over from gossip — used by some UI primitives)
export const springs = {
  default: { stiffness: 300, damping: 24 },
  bouncy: { stiffness: 400, damping: 18 },
  gentle: { stiffness: 200, damping: 30 },
  microBounce: { stiffness: 500, damping: 22 },
} as const;

export const BRAND = {
  name: "Spenders Club",
  domain: "spenders.club",
  tagline: "DSC — gifting list",
} as const;
