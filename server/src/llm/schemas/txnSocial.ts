import { z } from "zod";

export const TxnSocialOutput = z.object({ looksSocial: z.boolean(), reason: z.string() });
export type TxnSocialOutput = z.infer<typeof TxnSocialOutput>;
