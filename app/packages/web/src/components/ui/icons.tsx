/**
 * A small, consistent outline icon set (docs/ui/UI_DESIGN_SYSTEM.md
 * "Icons" — one consistent family, Lucide-style). Hand-drawn as simple
 * geometric SVG rather than vendored from a specific library, since
 * adding an icon package requires an `npm install` this session cannot
 * safely run from WSL — see the UI rebuild's final report for the full
 * reasoning. 24x24 viewBox, 2px stroke, round joins throughout, so every
 * icon in the app reads as one family regardless of source.
 */
import type { SVGProps } from "react";

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function base(props: IconProps) {
  const { size = 20, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function ReviewIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PackageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 4 7v10l8 4 8-4V7Z" />
      <path d="M4 7l8 4 8-4" />
      <path d="M12 11v10" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 2.75v3M12 18.25v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.75 12h3M18.25 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M11 6.5l1.6-1.6a3.5 3.5 0 0 1 5 5L16 11.5" />
      <path d="M13 17.5l-1.6 1.6a3.5 3.5 0 0 1-5-5L8 12.5" />
    </svg>
  );
}

export function ScoreIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 19V13M10 19V8M16 19v-7M21 6l-6 6-3-3-5 5" />
    </svg>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5h9l4.5 4.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14.5 3.5V8H19" />
      <path d="M8 12.5h8M8 16h5" />
    </svg>
  );
}

export function DetailsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7.5 9h9M7.5 12.5h9M7.5 16h5" />
    </svg>
  );
}

export function IdentifyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8.5" r="3" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M4 12h16" />
    </svg>
  );
}

export function DuplicateIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3" />
    </svg>
  );
}

export function SpinnerIcon(props: IconProps) {
  const { size = 20, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="icon-spin"
      {...rest}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
