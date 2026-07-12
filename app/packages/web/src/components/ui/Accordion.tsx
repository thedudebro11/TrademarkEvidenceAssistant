import type { ReactNode } from "react";
import { ChevronDownIcon } from "./icons.js";

export interface AccordionSection {
  id: string;
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  content: ReactNode;
}

interface AccordionProps {
  sections: AccordionSection[];
  openId: string | null;
  onOpenChange: (id: string) => void;
}

/**
 * Single-open accordion (progressive disclosure) — WAI-ARIA disclosure
 * pattern, fully keyboard operable via native <button>.
 * docs/ui/UI_INFORMATION_ARCHITECTURE.md: "The user should not see every
 * control expanded simultaneously."
 */
export function Accordion({ sections, openId, onOpenChange }: AccordionProps) {
  return (
    <div>
      {sections.map((section) => {
        const isOpen = section.id === openId;
        const panelId = `accordion-panel-${section.id}`;
        const triggerId = `accordion-trigger-${section.id}`;
        return (
          <div className="accordion-section" key={section.id}>
            <h3>
              <button
                id={triggerId}
                className="accordion-section__trigger"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => onOpenChange(section.id)}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  {section.icon}
                  {section.title}
                  {section.badge}
                </span>
                <ChevronDownIcon size={18} className="accordion-section__chevron" />
              </button>
            </h3>
            {isOpen && (
              <div id={panelId} role="region" aria-labelledby={triggerId} className="accordion-section__panel motion-fade-in">
                {section.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
