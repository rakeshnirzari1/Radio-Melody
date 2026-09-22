import React from "react";
import { Search, Heart, Clock, Info, Radio, Globe2, Trophy } from "lucide-react";

const NavButton = ({ icon: Icon, label, onClick, active }) => (
  <button
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`group flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-all duration-200 sm:px-3.5 ${
      active
        ? "bg-[#2fe08a]/15 text-[#7bf0b8]"
        : "text-[#9fb3aa] hover:text-white hover:bg-white/5"
    }`}
  >
    <Icon size={17} strokeWidth={2} />
    <span className="hidden md:inline">{label}</span>
  </button>
);

/**
 * Six nav items plus a wordmark do not fit beside each other on a phone: the pill
 * used to run off the right edge and the wordmark slid underneath it. Below the sm
 * breakpoint the header is therefore two rows — logo, then nav centred beneath it
 * — which fits any phone width without scrolling or clipping.
 *
 * The logo also sits on its own opaque chip. It was previously floating straight
 * over the globe, so the map's station dots showed through around the wordmark and
 * made the brand look like part of the map.
 */
const Header = ({ onOpen, activePanel, onHome }) => {
  const ref = React.useRef(null);

  // Publish the header's real height as a CSS variable. Anything sitting under the
  // header (the genre chips) can then clear it without guessing a number: the header
  // is one row on a laptop and two on a phone, and it grows again with the notch
  // inset. Guesswork is exactly what put the genre bar under the nav pill.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const publish = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) {
        document.documentElement.style.setProperty("--rm-header-h", `${h}px`);
      }
    };
    publish();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(publish);
      ro.observe(el);
    }
    window.addEventListener("resize", publish);
    window.addEventListener("orientationchange", publish);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", publish);
      window.removeEventListener("orientationchange", publish);
    };
  }, []);

  return (
    <header
      ref={ref}
      className="rm-safe-top pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-4"
    >
      {/* Soft scrim under the header: keeps the wordmark readable over the globe. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#05070a] via-[#05070a]/70 to-transparent sm:h-28" />

      <div className="relative flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <button
          onClick={onHome}
          className="group pointer-events-auto flex w-max items-center gap-2.5 rounded-2xl bg-[#05070a]/90 px-2.5 py-1.5 ring-1 ring-white/10 backdrop-blur-md"
        >
          <span className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#2fe08a] text-[#05070a] shadow-[0_0_22px_rgba(47,224,138,0.55)] transition-transform group-hover:scale-105">
            <Radio size={19} strokeWidth={2.4} />
          </span>
          <span className="leading-none">
            <span className="block font-display text-lg font-700 tracking-tight text-white">
              Radio<span className="text-[#2fe08a]">Melody</span>
            </span>
            <span className="mt-0.5 block text-[9px] uppercase tracking-[0.22em] text-[#6f857b] sm:text-[10px] sm:tracking-[0.25em]">
              Listen to the world
            </span>
          </span>
        </button>

        <nav className="pointer-events-auto flex w-max max-w-full items-center gap-0.5 self-center rounded-full rm-glass px-1.5 py-1.5 sm:self-auto sm:gap-1">
          <NavButton
            icon={Globe2}
            label="Explore"
            active={activePanel === "explore"}
            onClick={() => onOpen("explore")}
          />
          <NavButton
            icon={Search}
            label="Search"
            active={activePanel === "search"}
            onClick={() => onOpen("search")}
          />
          <NavButton
            icon={Trophy}
            label="Around"
            active={activePanel === "challenge"}
            onClick={() => onOpen("challenge")}
          />
          <NavButton
            icon={Heart}
            label="Favorites"
            active={activePanel === "favorites"}
            onClick={() => onOpen("favorites")}
          />
          <NavButton
            icon={Clock}
            label="History"
            active={activePanel === "history"}
            onClick={() => onOpen("history")}
          />
          <NavButton
            icon={Info}
            label="About"
            active={activePanel === "about"}
            onClick={() => onOpen("about")}
          />
        </nav>
      </div>
    </header>
  );
};

export default Header;
