import type { Database } from "@/lib/supabase/database.types";
import { formatMoney } from "@/lib/format";

type LocationType = Database["public"]["Enums"]["location_type"];
type BookingStatus = Database["public"]["Enums"]["booking_status"];

export const LOCATION_LABELS: Record<LocationType, string> = {
  in_person: "In person",
  virtual: "Video call",
  phone: "Phone call",
  client_location: "At your location",
};

export function locationSummary(st: { location_type: LocationType; location_details: string | null }, fallback?: string | null): string {
  if (st.location_type === "in_person") return st.location_details ?? fallback ?? "In person";
  if (st.location_type === "client_location") return st.location_details ? `At your location (${st.location_details})` : "At your location";
  return LOCATION_LABELS[st.location_type];
}

export function priceLabel(st: { price_cents: number; currency: string; is_consultation: boolean }): string {
  if (st.is_consultation || st.price_cents === 0) return "Free";
  return formatMoney(st.price_cents, st.currency);
}

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
  late_cancelled: "Late cancel",
};

export const STATUS_TONES: Record<BookingStatus, "neutral" | "brand" | "green" | "amber" | "red" | "blue" | "purple"> = {
  pending_payment: "amber",
  confirmed: "blue",
  cancelled: "neutral",
  completed: "green",
  no_show: "red",
  late_cancelled: "purple",
};
