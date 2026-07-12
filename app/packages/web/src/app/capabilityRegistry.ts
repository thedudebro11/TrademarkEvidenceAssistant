import type { AppPath } from "./router.js";

/**
 * Frontend capability registry (docs/ui/UI_COMPONENT_ARCHITECTURE.md
 * "Capability registry"). Not a plugin system and contains no business
 * logic — pure data controlling where implemented features appear.
 * Disabled capabilities are never shown. Reserved future placements
 * (docs/ui/UI_FEATURE_PLACEMENT_MAP.md) stay `enabled: false` until a
 * real feature is built — no empty nav items, ever.
 */
export interface UiCapability {
  id: string;
  label: string;
  route?: AppPath;
  placement: "primary-nav" | "home-action" | "review-panel" | "prepare-step" | "hidden";
  enabled: boolean;
}

export const CAPABILITIES: UiCapability[] = [
  { id: "home", label: "Home", route: "/", placement: "primary-nav", enabled: true },
  { id: "review", label: "Review", route: "/review", placement: "primary-nav", enabled: true },
  { id: "prepare", label: "Prepare Package", route: "/prepare", placement: "primary-nav", enabled: true },
  { id: "settings", label: "Settings", route: "/settings", placement: "primary-nav", enabled: true },

  // Reserved future placements — design reservations only, per
  // docs/ui/UI_FEATURE_PLACEMENT_MAP.md "Reserved future placements".
  // Never rendered while enabled: false.
  { id: "evidence-library", label: "Evidence Library", placement: "hidden", enabled: false },
  { id: "follow-up-queue", label: "Follow-Up", placement: "hidden", enabled: false },
  { id: "connections-nav", label: "Connections", placement: "hidden", enabled: false },
  { id: "timeline", label: "Timeline", placement: "hidden", enabled: false },
  { id: "filing-prep", label: "Filing Prep", placement: "hidden", enabled: false },
];

export function getCapabilities(placement: UiCapability["placement"]): UiCapability[] {
  return CAPABILITIES.filter((c) => c.placement === placement && c.enabled);
}
