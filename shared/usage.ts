import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const usageWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPct: z.number().nullable(),
  remainingPct: z.number().nullable(),
  resetsAt: z.string().nullable(),
});
export const usageReportSchema = z.object({
  profileId: z.string(),
  label: z.string(),
  provider: z.string(),
  status: z.enum(["available", "unavailable", "error"]),
  message: z.string().nullable(),
  source: z.string(),
  planLabel: z.string().nullable(),
  email: z.string().nullable().default(null),
  fetchedAt: z.string(),
  windows: z.array(usageWindowSchema),
});
export type UsageWindow = z.infer<typeof usageWindowSchema>;
export type UsageReport = z.infer<typeof usageReportSchema>;
export const usageRpc = defineRpc({
  name: "profiles.usage",
  input: z.object({ force: z.boolean().default(false) }),
  output: z.object({ reports: z.array(usageReportSchema) }),
});
