import { GlassPanel } from "../ui/GlassPanel.js";
import { HomeIcon, PackageIcon, ReviewIcon, SettingsIcon, type IconProps } from "../ui/icons.js";
import { Link, useRouter } from "../../app/router.js";
import { getCapabilities } from "../../app/capabilityRegistry.js";

const NAV_ICONS: Record<string, (props: IconProps) => JSX.Element> = {
  home: HomeIcon,
  review: ReviewIcon,
  prepare: PackageIcon,
  settings: SettingsIcon,
};

/** Always-visible primary navigation, driven entirely by the capability registry. */
export function Sidebar() {
  const { path } = useRouter();
  const items = getCapabilities("primary-nav");

  return (
    <GlassPanel as="nav" className="sidebar" aria-label="Primary">
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark" aria-hidden="true" />
        <span className="sidebar__brand-name">Trademark Evidence Assistant</span>
      </div>
      <div className="sidebar__nav">
        {items.map((item) => {
          const Icon = item.route ? NAV_ICONS[item.id] : undefined;
          const isActive = item.route === path;
          return (
            <Link
              key={item.id}
              to={item.route!}
              className="sidebar__nav-link"
              aria-current={isActive ? "page" : undefined}
            >
              {Icon && <Icon size={19} />}
              <span className="sidebar__nav-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </GlassPanel>
  );
}
