export const CONDITIONS = [
  "New",
  "Used - Like New",
  "Used - Good",
  "Used - Fair",
] as const;

export type Condition = (typeof CONDITIONS)[number];

export const DEFAULT_CONDITION: Condition = "Used - Good";

export function isCondition(value: string): value is Condition {
  return (CONDITIONS as readonly string[]).includes(value);
}
