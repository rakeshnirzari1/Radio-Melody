import React from "react";
import { Search, Heart, Clock, Info, Radio, Menu } from "lucide-react";

const NavButton = ({ icon: Icon, label, onClick, active }) => (
  <button
    onClick={onClick}
    className={`group flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-all duration-200 ${
      active
        ? "bg-[#2fe08a]/15 text-[#7bf0b8]"
        : "text-[#9fb3aa] hover:text-white hover:bg-white/5"
    }`}
  >
    <Icon size={17} strokeWidth={2} />
    <span className="hidden md:inline">{label}</span>
  </button>
);

const Header = ({ onOpen, activePanel, onHome }) => {
  return (
    <header className="rm-safe-top pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-4 sm:px-6">
      <button
        onClick={onHome}
        className="pointer-events-auto flex items-center gap-2.5 group"
      >
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[#2fe08a] text-[#05070a] shadow-[0_0_22px_rgba(47,224,138,0.55)] transition-transform group-hover:scale-105">
          <Radio size={19} strokeWidth={2.4} />
        </span>
        <div className="leading-none">
          <div className="font-display text-lg font-700 tracking-tight text-white">
            Radio<span className="text-[#2fe08a]">Melody</span>
          </div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-[#6f857b]">
            Listen to the world
          </div>
        </div>
      </button>

      <nav className="pointer-events-auto flex items-center gap-1 rounded-full rm-glass px-1.5 py-1.5">
        <NavButton
          icon={Search}
          label="Search"
          active={activePanel === "search"}
          onClick={() => onOpen("search")}
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
    </header>
  );
};

export default Header;
