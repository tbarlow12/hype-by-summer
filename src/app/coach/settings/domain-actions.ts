"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, type ActionState } from "@/lib/actions";
import { PLATFORM_DOMAIN } from "@/lib/platform";
import { businessUrl } from "@/lib/tenant";
import { normalizeDomain } from "@/lib/clients/domains";
import {
  addProjectDomain,
  domainResolvesToPlatform,
  projectDomainStatus,
  removeProjectDomain,
  vercelConfigured,
} from "@/lib/clients/vercel";

// custom_domain / domain_verified_at aren't writable by the user's API role:
// every write here goes through the service role after requireManager(),
// scoped to the manager's own business.

const domainSchema = z.object({ domain: z.string().max(253) });

export async function setCustomDomain(_: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireManager();
  const parsed = parseForm(domainSchema, formData);
  if (parsed.error) return parsed.error;
  const norm = normalizeDomain(parsed.data.domain, PLATFORM_DOMAIN);
  if ("error" in norm) return fail(norm.error);
  const domain = norm.domain;
  if (domain === business.custom_domain) return ok("That domain is already set. Add the DNS records below, then check.");

  const admin = createAdminClient();
  const { data: taken } = await admin.from("businesses").select("id").eq("custom_domain", domain).neq("id", business.id).maybeSingle();
  if (taken) return fail("That domain is already connected to another site.");

  if (vercelConfigured()) {
    const added = await addProjectDomain(domain);
    if (!added.ok) return fail(added.error);
    if (business.custom_domain) await removeProjectDomain(business.custom_domain);
  }
  const { error } = await admin
    .from("businesses")
    .update({ custom_domain: domain, domain_verified_at: null })
    .eq("id", business.id);
  if (error) return fail(error.code === "23505" ? "That domain is already connected to another site." : error.message);
  revalidatePath("/coach/settings");
  return ok(`Added ${domain}. Now add the DNS records below at your domain provider, then press “Check now”.`);
}

export async function checkCustomDomain(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { business } = await requireManager();
  const domain = business.custom_domain;
  if (!domain) return fail("Add a domain first.");
  const admin = createAdminClient();

  let ready: boolean;
  let problem = "";
  if (vercelConfigured()) {
    const status = await projectDomainStatus(domain, { verify: true });
    if (status.error === "not_added") {
      const re = await addProjectDomain(domain);
      if (!re.ok) return fail(re.error);
      return fail("The domain was re-added to hosting. Give DNS a few minutes, then check again.");
    }
    if (status.error) return fail(`Couldn't reach the hosting provider: ${status.error}`);
    ready = status.verified && !status.misconfigured;
    problem = !status.verified
      ? "Ownership isn't verified yet: add the TXT record below."
      : "DNS doesn't point here yet: check the record below.";
  } else {
    ready = await domainResolvesToPlatform(domain);
    problem = "DNS doesn't point here yet: check the record below.";
  }

  if (!ready) {
    return fail(`${problem} DNS changes can take from a few minutes up to 48 hours to spread.`);
  }
  if (!business.domain_verified_at) {
    const { error } = await admin
      .from("businesses")
      .update({ domain_verified_at: new Date().toISOString() })
      .eq("id", business.id)
      .eq("custom_domain", domain);
    if (error) return fail(error.message);
  }
  revalidatePath("/", "layout");
  return ok(`${domain} is connected. Your site and client app now live at https://${domain}.`);
}

export async function removeCustomDomain(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { business } = await requireManager();
  const domain = business.custom_domain;
  if (!domain) return ok("No custom domain set.");
  if (vercelConfigured()) {
    const removed = await removeProjectDomain(domain);
    if (!removed.ok) return fail(removed.error ?? "Couldn't remove the domain from hosting.");
  }
  const { error } = await createAdminClient()
    .from("businesses")
    .update({ custom_domain: null, domain_verified_at: null })
    .eq("id", business.id);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  const home = businessUrl({ ...business, custom_domain: null, domain_verified_at: null }, "/coach/settings");
  return ok(`Removed ${domain}. Your site is at ${home}.`, { url: home });
}
