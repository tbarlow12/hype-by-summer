import "server-only";
import { getTenant, getTenantBySlug, type Tenant } from "@/lib/tenant";

// Compatibility layer: storefront lookups are scoped to the current request's
// tenant (see lib/tenant.ts). A slug that isn't this host's tenant resolves to
// null, so one trainer's domain never serves another trainer's pages.

export type PublicTrainer = Tenant;
export type TrainerProfile = Tenant;

export const getTrainerBySlug = (slug: string) => getTenantBySlug(slug);

/** The tenant whose site this request is for. */
export const getPrimaryTrainer = () => getTenant();
